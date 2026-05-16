const { createHash } = require('crypto');

// ==========================================
// REMPLACE CES VALEURS PAR TON AUTRE COMPTE
// ==========================================
const KEY_ID  = '003ec0649a89f090000000001';
const APP_KEY = 'K003dwNhrjinpVEyi4VKsJxxZmL3LO4';
const BUCKET  = 'melo-music-2026';
const META    = 'melo-metadata.json';


function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function b2Auth() {
  const r = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${APP_KEY}`).toString('base64') }\n  });
  if (!r.ok) throw new Error('Auth B2 failed: ' + r.status);
  return r.json();
}

async function getBucketId(a) {
  if (a.allowed?.bucketId) return a.allowed.bucketId;
  const r = await fetch(`${a.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: a.accountId, bucketName: BUCKET })
  });
  if (!r.ok) throw new Error('List buckets failed');
  const d = await r.json();
  const b = d.buckets?.find(x => x.bucketName === BUCKET);
  if (!b) throw new Error(`Bucket "${BUCKET}" introuvable`);
  return b.bucketId;
}

async function getUploadUrl(a, bid) {
  const r = await fetch(`${a.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: bid })
  });
  if (!r.ok) throw new Error('Get upload URL failed');
  return r.json();
}

async function b2UploadBuf(url, token, name, buf, mime) {
  const sha = createHash('sha1').update(buf).digest('hex');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      'X-Bz-File-Name': encodeURIComponent(name),
      'Content-Type': mime || 'application/octet-stream',
      'X-Bz-Content-Sha1': sha
    },
    body: buf
  });
  if (!r.ok) throw new Error('Upload failed: ' + r.status);
  return r.json();
}

async function deleteOldMetaVersions(a, bid, keepId) {
  try {
    const r = await fetch(`${a.apiUrl}/b2api/v2/b2_list_file_versions`, {
      method: 'POST',
      headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: bid, fileName: META })
    });
    if (!r.ok) return;
    const d = await r.json();
    if (!d.files) return;
    for (const f of d.files) {
      if (f.fileId !== keepId) {
        await fetch(`${a.apiUrl}/b2api/v2/b2_delete_file_version`, {
          method: 'POST',
          headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: META, fileId: f.fileId })
        });
      }
    }
  } catch (e) {}
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query.action || req.body?.action;
    const a   = await b2Auth();
    const bid = await getBucketId(a);

    /* ── INIT ── */
    if (action === 'init') {
      let tracks = [], playlists = [], albums = [], artists = [];
      let lastModified = Date.now();
      try {
        const durl = `${a.downloadUrl}/file/${BUCKET}/${META}`;
        const r = await fetch(durl, { headers: { Authorization: a.authorizationToken } });
        if (r.ok) {
          const d = await r.json();
          tracks    = Array.isArray(d.tracks)    ? d.tracks    : (Array.isArray(d) ? d : []);
          playlists = Array.isArray(d.playlists) ? d.playlists : [];
          albums    = Array.isArray(d.albums)    ? d.albums    : [];
          artists   = Array.isArray(d.artists)   ? d.artists   : [];
          lastModified = d.lastModified || Date.now();
        }
      } catch (e) {}

      // Génération du token de téléchargement pour 7 jours (604800s)
      const tokRes = await fetch(`${a.apiUrl}/b2api/v2/b2_get_download_authorization`, {
        method: 'POST',
        headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: bid, fileNamePrefix: '', validDurationInSeconds: 604800 })
      });
      let dlToken = '';
      if (tokRes.ok) {
        const td = await tokRes.json();
        dlToken = td.authorizationToken;
      }

      res.status(200).json({
        tracks, playlists, albums, artists, lastModified,
        downloadUrl: a.downloadUrl + '/file/' + BUCKET + '/',
        downloadToken: dlToken
      });
      return;
    }

    /* ── GET UPLOAD URL ── */
    if (action === 'get-upload') {
      const up = await getUploadUrl(a, bid);
      res.status(200).json({ uploadUrl: up.uploadUrl, authorizationToken: up.authorizationToken });
      return;
    }

    /* ── SAVE METADATA ── */
    if (action === 'save-meta' && req.method === 'POST') {
      const body = req.body;
      const tracks       = Array.isArray(body?.tracks)    ? body.tracks    : (Array.isArray(body) ? body : []);
      const playlists    = Array.isArray(body?.playlists)  ? body.playlists : [];
      const albums       = Array.isArray(body?.albums)     ? body.albums    : [];
      const artists      = Array.isArray(body?.artists)    ? body.artists   : [];
      const lastModified = body?.lastModified || Date.now();
      const buf = Buffer.from(JSON.stringify({ tracks, playlists, albums, artists, lastModified }), 'utf-8');
      const up  = await getUploadUrl(a, bid);
      const uploaded = await b2UploadBuf(up.uploadUrl, up.authorizationToken, META, buf, 'application/json');
      
      await deleteOldMetaVersions(a, bid, uploaded.fileId);
      res.status(200).json({ ok: true, fileId: uploaded.fileId });
      return;
    }

    /* ── DELETE FILE ── */
    if (action === 'delete') {
      const { key, fileId } = req.query;
      if (key && fileId) {
        await fetch(`${a.apiUrl}/b2api/v2/b2_delete_file_version`, {
          method: 'POST',
          headers: { Authorization: a.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: key, fileId })
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Action inconnue ou mauvaise méthode' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
