export const requireLogin = (req, res, next) => {
  if (req.session?.user) return next();
  res.redirect('/login');
};

export const requireAdmin = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    const err = new Error('Forbidden');
    err.status = 403;
    return next(err);
  }
  next();
};
