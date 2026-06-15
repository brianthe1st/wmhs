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

module.exports = { validate };
