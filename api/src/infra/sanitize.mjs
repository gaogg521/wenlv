// 富文本清洗：后台富文本会原样下发到小程序 rich-text 与公开页，必须去掉可执行内容。
// 黑名单标签整体移除 + 事件属性移除 + javascript:/vbscript:/data:text 协议改写；图片只允许 http(s) 与站内 /uploads 路径。
const BAD_TAGS = 'script|style|iframe|frame|frameset|object|embed|applet|form|input|button|textarea|select|svg|math|link|meta|base|noscript|template'

export function sanitizeRich(html, max = 200000) {
  let s = String(html || '')
  s = s.replace(new RegExp(`<\\s*(${BAD_TAGS})[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'), '')
       .replace(new RegExp(`<\\s*\\/?\\s*(${BAD_TAGS})[^>]*>`, 'gi'), '')
       .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
       .replace(/(href|src|xlink:href|action|formaction)\s*=\s*(["']?)\s*(?:javascript|vbscript|data:text)[^"'\s>]*\2/gi, '$1="#"')
       // 图片地址：带引号/不带引号都处理，只放行 http(s) 与站内 /uploads
       .replace(/<img\b([^>]*?)\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, pre, a, b, c) => {
         const u = (a ?? b ?? c ?? '').trim()
         return `<img${pre} src="${/^(https?:\/\/|\/uploads\/)/.test(u) ? u.replace(/"/g, '') : '#'}"`
       })
       .replace(/style\s*=\s*(["'])[^"']*(?:expression|url\s*\(\s*['"]?\s*javascript)[^"']*\1/gi, '')
  return s.slice(0, max)
}

/** 富文本的纯文字长度（用于必填判断与字数统计） */
export const richTextLength = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().length
