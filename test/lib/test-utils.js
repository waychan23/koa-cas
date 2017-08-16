const { expect } = require('chai');
const hideLog = true;

exports.hooks = {
  async before(ctx) {
    ctx.start = Date.now();
  },
  async after(ctx) {
    console.log(`after hook: costTime=${Date.now() - ctx.start} ms. `);
    expect(ctx.start).to.not.be.empty;
  },
};

exports.logger = hideLog ? null : (req, type) => {
  switch (type) { // cas日志不用那么详细, 有问题后再打开
    case 'access':
      return console.log.bind(console);
    case 'log':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    default:
      return console.log.bind(console, type, '[CONNECT-CAS]::');
  }
};

exports.sessionStHook = (app) => {
  app.use(async function (ctx, next) {
    ctx.session.cas = {
      user: '156260767',
      st: 'st',
    };
    await next();
  });
};

exports.sessionStAndPgtHook = (app) => {
  app.use(async function (ctx, next) {
    ctx.session.cas = {
      user: '156260767',
      st: 'st',
      pgt: 'pgt',
    };
    await next();
  });
};
