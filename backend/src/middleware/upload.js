const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const CloudinaryStorage = require('multer-storage-cloudinary');
const path = require('path');
const fs = require('fs');

const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024;
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';

let storage;

if (STORAGE_MODE === 'cloudinary') {
  console.log('☁️  Storage: Using Cloudinary');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.warn('⚠️  WARNING: Cloudinary credentials missing. Uploads will fail.');
  }

  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    folder: 'wmhs_materials',
    allowedFormats: Object.values(ALLOWED_TYPES),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      cb(null, `${Date.now()}_${base}`);
    },
  });
} else {
  console.log('📁  Storage: Using local disk storage');
  const uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  });
}

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
  cb(new Error(`File type not allowed. Allowed: PDF, PPTX, DOCX, XLSX, JPG, PNG.`), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

// Middleware that attaches fileType and fileUrl to req after upload
function withFileType(req, res, next) {
  if (req.file) {
    req.file.fileType = ALLOWED_TYPES[req.file.mimetype] || 'file';
    
    if (STORAGE_MODE === 'cloudinary') {
      req.file.fileUrl = req.file.path; // Cloudinary returns URL in 'path'
    } else {
      // For local, we create a URL path. Ensure your server serves /uploads as static.
      req.file.fileUrl = `/uploads/${req.file.filename}`;
    }
  }
  next();
}

module.exports = { upload, withFileType };
