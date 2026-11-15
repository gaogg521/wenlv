import { jwtSign, jwtVerify, authUser } from '../auth.mjs'
import { one } from '../db.mjs'

const namePattern = /^(?:note_([0-9]+)_[0-9]+\.(?:jpg|png|webp)|ugc-video-([0-9]+)-[0-9a-f-]{36}\.(?:mp4|mov))$/

export function noteMediaOwner(url) {
  const match = typeof url === 'string' && namePattern.exec(url.replace(/^\/uploads\//,''))
  return match ? Number(match[1] || match[2]) : null
}

export function noteMediaTicket(path, seconds = 900, purpose = 'note-editor') {
  return path + '?media=' + jwtSign({ purpose, path }, seconds)
}

const matches = `(JSON_CONTAINS(JSON_EXTRACT(body,'$.images'), JSON_QUOTE(?))
      OR JSON_UNQUOTE(JSON_EXTRACT(body,'$.video'))=?
      OR JSON_UNQUOTE(JSON_EXTRACT(body,'$.cover'))=?
      OR JSON_CONTAINS(JSON_EXTRACT(body,'$.livePhotos[*].motion'), JSON_QUOTE(?)))`

export async function conflictingMediaVisibility(db, path, visibility, noteId) {
  return db.one(`SELECT id FROM content_note WHERE visibility<>? AND id<>? AND ${matches} LIMIT 1`,
    [visibility,noteId || 0,path,path,path,path])
}

export async function canReadNoteMedia(path, token, req) {
  const user = authUser(req)
  if (user?.end === 'c' && Number(user.uid) === noteMediaOwner(path)) return true
  const claim = jwtVerify(token)
  const args = [path,path,path,path]
  if (claim?.purpose === 'note-review' && claim.path === path) return true
  const state = await one(`SELECT MAX(visibility='public' AND status=2) public_asset, MAX(visibility='private') private_asset
    FROM content_note WHERE ${matches}`, args)
  if (Number(state?.private_asset) === 1) return false
  if (Number(state?.public_asset) === 1) return true
  return Number(state?.private_asset) !== 1 && claim?.purpose === 'note-editor' && claim.path === path
}
