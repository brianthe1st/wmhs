const multer = require('multer');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

// ── What is allowed ───────────────────────────────────────────────────────────
// The stored file's extension ALWAYS comes from this table (never from the client's
// file name), and the first bytes of the file must match the claimed type.
const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const SIGNATURES = {
  pdf:  [Buffer.from('%PDF')],
  jpg:  [Buffer.from([0xff, 0xd8, 0xff])],
  png:  [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],   // zip container
  pptx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  xlsx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  doc:  [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],   // old OLE container
};

const CONTENT_TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10) * 1024 * 1024;
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';
// On Render the container disk is wiped on every deploy: set UPLOAD_DIR to a mounted
// persistent disk, or use STORAGE_MODE=cloudinary.
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

let cloudinary = null;
let CloudinaryStorage = null;
if (STORAGE_MODE === 'cloudinary') {
  ({ v2: cloudinary } = require('cloudinary'));
  CloudinaryStorage = require('multer-storage-cloudinary');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.warn('⚠️  WARNING: Cloudinary credentials missing. Uploads will fail.');
  }
  console.log('☁️  Storage: Cloudinary');
} else {
  console.log(`📁  Storage: local disk at ${UPLOAD_ROOT}`);
}

function makeStorage(subdir) {
  if (STORAGE_MODE === 'cloudinary') {
    return new CloudinaryStorage({
      cloudinary,
      folder: `wmhs_${subdir}`,
      allowedFormats: Object.values(ALLOWED_TYPES),
      filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`),
    });
  }
  const dir = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.${ALLOWED_TYPES[file.mimetype]}`),
  });
}

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
  cb(new Error('File type not allowed. Allowed: PDF, PPTX, DOCX, XLSX, DOC, JPG, PNG.'), false);
};

function makeUploader(subdir) {
  return multer({ storage: makeStorage(subdir), fileFilter, limits: { fileSize: MAX_SIZE, files: 1 } });
}

const materialUpload   = makeUploader('materials');
const submissionUpload = makeUploader('submissions');

// Wrap multer so errors come back as a clean 400 and non-multipart requests pass through.
function runUpload(uploader, { optional = false } = {}) {
  return (req, res, next) => {
    if (optional && !req.is('multipart/form-data')) return next();
    uploader.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10}MB.` });
      }
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    });
  };
}

// After upload: check magic bytes (local mode), then attach fileType/fileUrl to req.file.
// fileUrl is "local:<subdir>/<name>" (served only through the authenticated /api/files route)
// or the Cloudinary https URL.
async function withFileType(req, res, next) {
  if (!req.file) return next();
  const ext = ALLOWED_TYPES[req.file.mimetype] || 'file';
  req.file.fileType = ext;
  if (STORAGE_MODE === 'cloudinary') {
    req.file.fileUrl = req.file.path;
    return next();
  }
  try {
    const fh = await fs.promises.open(req.file.path, 'r');
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 0);
    await fh.close();
    const ok = (SIGNATURES[ext] || []).some(sig => buf.subarray(0, sig.length).equals(sig));
    if (!ok) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `That file is not a real ${ext.toUpperCase()} file.` });
    }
    req.file.fileUrl = `local:${path.basename(path.dirname(req.file.path))}/${path.basename(req.file.path)}`;
    next();
  } catch (err) {
    console.error('Upload verification error:', err.message);
    res.status(500).json({ error: 'Could not verify the uploaded file.' });
  }
}

// Remove a stored local file (no-op for Cloudinary URLs).
function removeStoredFile(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('local:')) return;
  const abs = path.resolve(UPLOAD_ROOT, fileUrl.slice('local:'.length));
  if (abs.startsWith(UPLOAD_ROOT + path.sep)) fs.promises.unlink(abs).catch(() => {});
}

// Absolute path for a stored local file, or null if it would escape the upload folder.
function resolveStoredFile(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('local:')) return null;
  const abs = path.resolve(UPLOAD_ROOT, fileUrl.slice('local:'.length));
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

module.exports = {
  materialUpload, submissionUpload, runUpload, withFileType,
  removeStoredFile, resolveStoredFile, CONTENT_TYPES, ALLOWED_TYPES, STORAGE_MODE,
};
