const Koa = require('koa');
//const co = require('co');
const supertest = require('supertest');
const { logger, hooks } = require('./lib/test-utils');
const { expect } = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');

describe('proxyCallback符合预期', function() {

  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;

  let casClientApp;
  let casClientServer;
  let casServerApp;
  let casServer;
  let request;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;

  beforeEach(function(done) {

    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      logger,
      hooks,
    }, {
      beforeCasConfigHook(app) {
        app.use(async function (ctx, next) {
          if (typeof hookBeforeCasConfig === 'function') {
            return await hookBeforeCasConfig(ctx, next);
          } else {
            return await next();
          }
        });
      },
      afterCasConfigHook(app) {
        app.use(async function (ctx, next) {
          if (typeof hookAfterCasConfig === 'function') {
            return await hookAfterCasConfig(ctx, next);
          } else {
            return await next();
          }
        });
      },
    });

    (async function () {
      try{
        await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
        console.log(`casServer listen ${casPort}`);

        await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
        console.log(`casClientServer listen ${clientPort}`);
        request = supertest.agent(casClientApp.listen());
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  afterEach(function(done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    (async function () {
      try{
        await new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('啥参数都不带直接调用, 或是参数不合法(无pgtIou或pgtId) 直接响应200', function(done) {
    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/cas/proxyCallback') {
        const { pgtIou } = ctx.query;
        if (pgtIou) {
          const pgtInfo = await ctx.sessionStore.get(pgtIou);
          expect(pgtInfo).to.be.empty;
        }
      } else {
        await next();
      }
    };
    (async function () {
      try{
        await request.get('/cas/proxyCallback').expect(200);
        await request.get('/cas/proxyCallback?pgtIou=xxx').expect(200);
        await request.get('/cas/proxyCallback?pgtId=xxx').expect(200);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('传入pgtId/pgtIou, 能够正确存入, 并能通过pgtIou找到pgtId', function(done) {

    const fakePgtIou = 'pgtIou';
    const fakePgtId = 'pgtId';

    hookBeforeCasConfig = async function(ctx, next) {
      if (ctx.path === '/get') {
        expect(ctx.query.pgtIou).to.not.be.empty;
        const session = await ctx.sessionStore.get(ctx.query.pgtIou);
        ctx.body = session.pgtId;
      } else {
        await next();
      }
    };

    (async function () {
      try{
        let res = await request.get(`/cas/proxyCallback?pgtIou=${fakePgtIou}&pgtId=${fakePgtId}`).expect(200);
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get(`/get?pgtIou=${fakePgtIou}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        const pgtId = res.text;
        expect(pgtId).to.equal(fakePgtId);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

});
