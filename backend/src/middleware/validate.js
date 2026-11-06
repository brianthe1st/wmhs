const { validationResult } = require('express-validator');

// Run after express-validator chains — returns 422 with errors if invalid
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorArray = errors.array();
    return res.status(422).json({
      error: errorArray[0].msg,
      details: errorArray.map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Make every :param with these names reject non-UUID values with a clean 400
// (instead of letting Postgres throw and the API answer 500).
function uuidParams(router, ...names) {
  names.forEach(name => {
    router.param(name, (req, res, next, val) => {
      if (isUuid(val)) return next();
      res.status(400).json({ error: `Invalid ${name}.` });
    });
  });
}

// Parse ?limit & ?offset safely.
function paging(req, defLimit = 200, maxLimit = 1000) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defLimit));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  return { limit, offset };
}

module.exports = { validate, uuidParams, isUuid, paging };
