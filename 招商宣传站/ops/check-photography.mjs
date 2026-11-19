import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'photography.json'), 'utf8')).photos;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fail = message => { throw new Error(message); };
const actual = new Map();
const heroNames = ['wuzhen', 'culture', 'canal', 'wall'];
const heroes = [...html.matchAll(/<img class="hero-photo[^"]*" src="([^"]+)"/g)];
if (heroes.length !== 4) fail('Expected four hero photographs');
heroes.forEach((m, i) => actual.set('hero-' + heroNames[i], m[1]));
for (const name of ['mystery', 'women', 'friends', 'wellness', 'sport', 'family', 'culture', 'explore']) {
  const line = js.split('\n').find(line => line.startsWith('    ' + name + ': ['));
  const asset = line?.match(/'(assets\/[^']+)'/)?.[1];
  if (!asset) fail('Missing theme photograph: ' + name);
  actual.set('theme-' + name, asset);
}
const destinations = [...html.matchAll(/class="destination[^"]*"[^>]*><img src="([^"]+)"/g)];
if (destinations.length !== 2) fail('Expected two destination photographs');
actual.set('destination-town', destinations[0][1]); actual.set('destination-lake', destinations[1][1]);
const stories = [...html.matchAll(/class="story-image"><img src="([^"]+)"/g)];
if (stories.length !== 3) fail('Expected three story photographs');
['guilin', 'westlake', 'huangshan'].forEach((name, i) => actual.set('story-' + name, stories[i][1]));
const whyImgs = [...html.matchAll(/<img class="why-photo" src="([^"]+)"/g)];
if (whyImgs.length !== 3) fail('Expected three why photographs');
['participate', 'people', 'continue'].forEach((name, i) => actual.set('why-' + name, whyImgs[i][1]));
const creationPhoto = html.match(/<img class="creation-photo" src="([^"]+)"/);
if (!creationPhoto) fail('Expected one creation photograph');
actual.set('creation-share', creationPhoto[1]);
if (catalog.length !== actual.size) fail('Photograph catalog and showcase slots differ');
const ids = new Set(), hashes = new Set();
for (const photo of catalog) {
  if (actual.get(photo.slot) !== photo.asset) fail('Catalog does not match visible slot: ' + photo.slot);
  if (ids.has(photo.photoId)) fail('Original photograph reused: ' + photo.photoId);
  ids.add(photo.photoId);
  const data = fs.readFileSync(path.join(root, photo.asset));
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  if (hashes.has(hash)) fail('Identical photograph bytes reused under another filename');
  hashes.add(hash);
}
if (!html.includes('id="theme-photo" src="' + actual.get('theme-mystery') + '"')) fail('Default theme cover differs');
console.log(actual.size + ' showcase slots: unique original photographs, unique files, all references match');
