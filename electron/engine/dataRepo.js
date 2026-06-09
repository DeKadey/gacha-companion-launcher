// Private data repository — authenticated fetch from gacha-companion.
// Key is split to prevent trivial extraction.
const https  = require('https');
const crypto = require('crypto');

const _s1 = 'a22ec58f', _s2 = '787dbbd0', _s3 = '9f1b5288', _s4 = '58585192';
const _s5 = '0dd7504d', _s6 = '6580cb08', _s7 = 'f24ba62a', _s8 = '758e3ff8';
const _iv  = 'bc5d64cc374e6b449f8454dd389455f9';
const _enc = '8d5b18ac901173719c47fbd83aba8ec81c1c49b62f350597b09148a287674038ff53841a027ef03436e02639e4a160c0b5cc9bc47285c90293813fa8a9a9cefec6ede73e0cc29f7b2fb6686ef777e87d431269109123fc5b9a9080c5f0d1e16f';

const OWNER  = 'DeKadey';
const REPO   = 'gacha-companion';
const BRANCH = 'main';

function _tok() {
  const k  = Buffer.from([_s1,_s2,_s3,_s4,_s5,_s6,_s7,_s8].join(''), 'hex');
  const iv = Buffer.from(_iv, 'hex');
  const d  = crypto.createDecipheriv('aes-256-cbc', k, iv);
  return Buffer.concat([d.update(Buffer.from(_enc, 'hex')), d.final()]).toString('utf8');
}

function _repoFetch(filePath, binary) {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${filePath}`;
    const req = https.get(url, {
      timeout: 20000,
      headers: { Authorization: `token ${_tok()}`, 'User-Agent': 'GachaTracker' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(c);
        resolve(binary ? buf : buf.toString('utf-8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

/**
 * Conditional fetch using If-None-Match. Pass a previously stored ETag to skip
 * re-downloading unchanged files. Returns:
 *   { notModified: true,  etag }            — 304: caller should use its cache
 *   { notModified: false, etag, body }       — 200: fresh content + new ETag
 */
function fetchRepoFileConditional(filePath, etag) {
  return new Promise((resolve, reject) => {
    const url     = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${filePath}`;
    const headers = { Authorization: `token ${_tok()}`, 'User-Agent': 'GachaTracker' };
    if (etag) headers['If-None-Match'] = etag;
    const req = https.get(url, { timeout: 20000, headers }, (res) => {
      if (res.statusCode === 304) {
        res.resume();
        resolve({ notModified: true, etag });
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const responseEtag = res.headers['etag'] ?? null;
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        resolve({ notModified: false, etag: responseEtag, body: Buffer.concat(c).toString('utf-8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

/**
 * Fetches a text file from the private data repository.
 * @param {string} filePath  e.g. 'hsr/name-id-map.json'
 * @returns {Promise<string>}
 */
function fetchRepoFile(filePath)   { return _repoFetch(filePath, false); }

/**
 * Fetches a binary file from the private data repository.
 * @param {string} filePath  e.g. 'hsr/images/1001.png'
 * @returns {Promise<Buffer>}
 */
function fetchRepoBuffer(filePath) { return _repoFetch(filePath, true); }

module.exports = { fetchRepoFile, fetchRepoBuffer, fetchRepoFileConditional };
