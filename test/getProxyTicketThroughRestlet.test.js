const Koa = require('koa');
//const co = require('co');
const supertest = require('supertest');
const { logger } = require('./lib/test-utils');
const { expect } = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');
const globalPGTStore = require('../lib/globalStoreCache');

describe('利用restlet integration访问正常', function() {

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
  let serverRequest;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;

  beforeEach(function(done) {
    globalPGTStore.clear();
    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      paths: {
        restletIntegration: '/cas/v1/tickets',
      },
      restletIntegration: {
        demo1: {
          trigger(ctx) {
            if (ctx.path.indexOf('restlet') > -1) return true;
          },
          params: {
            username: 'username',
            from: 'somewhere',
            type: 8,
            password: 'password',
          },
        },
      },
      logger,
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
      await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
      console.log(`casServer listen ${casPort}`);
      serverRequest = supertest.agent(casServerApp.listen());

      await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      console.log(`casClientServer listen ${clientPort}`);
      request = supertest.agent(casClientApp.listen());
      done();
    })();
  });

  afterEach(function(done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    (async function () {
      await new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));
      await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
      globalPGTStore.clear();
      done();
    })();
  });

  it('未登陆下, 配置restletIntegration, 命中规则, 不需要跳登陆, 且能够正确获取pt, 再次调用时, 使用缓存的pgtId, 新的pt', function(done) {
    let pgt;

    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/restlet') {
        if (ctx.query && ctx.query.time) {
          const cachedPgt = globalPGTStore.get('demo1');
          expect(cachedPgt).to.equal(pgt);
        }
        const pt = await ctx.getProxyTicket('some targetService');
        pgt = globalPGTStore.get('demo1');
        expect(pgt).to.not.be.empty;
        ctx.body = pt;
      } else {
        await next();
      }
    };

    (async function () {
      try{
        let res = await request.get('/restlet').expect(200);
        expect(res.text).to.not.be.empty;
        const pt = res.text;
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/restlet?time=1').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        const secondPt = res.text;
        expect(secondPt).to.not.equal(pt);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('登陆下, 配置restletIntegration, 命中规则, 命中规则的接口以restletIntegration的身份调取接口, 但不影响已登录用户的身份.', function(done) {
    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/') {
        const loginedPt = await ctx.getProxyTicket('xxx');
        ctx.body = loginedPt;
      } else if (ctx.path === '/restlet') {
        if (ctx.query && ctx.query.time) {
          const cachedPgt = globalPGTStore.get('demo1');
          expect(cachedPgt).to.not.be.empty;
        }
        const restletPt = await ctx.getProxyTicket('xxx');
        ctx.body = restletPt;
      } else {
        await next();
      }
    };

    (async function () {
      let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
      const cookies = handleCookies.setCookies(res.header);
      expect(res.header.location).to.equal('/');

      res = await request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const loginedPt = res.text;
      expect(loginedPt).to.not.be.empty;

      res = await request.get('/restlet').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.empty;
      const restletPt = res.text;
      expect(loginedPt).to.not.equal(restletPt);
      done();
    })();
  });

  it('配置restletIntegration, 命中规则, 命中规则的接口以restletIntegration的身份调取接口, 再登陆, 然后访问正常接口, 互不影响', function(done) {
    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/') {
        const loginedPt = await ctx.getProxyTicket('xxx');
        ctx.body = loginedPt;
      } else if (ctx.path === '/restlet') {
        if (ctx.query && ctx.query.time) {
          const cachedPgt = globalPGTStore.get('demo1');
          expect(cachedPgt).to.not.be.empty;
        }
        const restletPt = await ctx.getProxyTicket('xxx');
        ctx.body = restletPt;
      } else {
        await next;
      }
    };

    (async function () {
      try{
        let res = await request.get('/restlet').expect(200);
        const restletPt = res.text;
        const cookies = handleCookies.setCookies(res.header);
        expect(res.text).to.not.empty;
        expect(cookies.SESSIONID).to.not.empty;

        res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.equal('/');

        res = await request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        const loginedPt = res.text;
        expect(loginedPt).to.not.be.empty;
        expect(loginedPt).to.not.equal(restletPt);

        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('未登陆下, 配置restletIntegration, 命中规则, 乱设一个pgt在globalStore, 能够自动重试并重新获取pgt, 然后获取pt', function(done) {
    globalPGTStore.set('demo1', 'some invalid pgt');

    let invalidPgt;
    let validPgt;

    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/restlet') {
        invalidPgt = globalPGTStore.get('demo1');

        const pt = await ctx.getProxyTicket('xxx');
        // should refetch a new pgt
        validPgt = globalPGTStore.get('demo1');
        expect(validPgt).to.not.equal(invalidPgt);
        expect(pt).to.not.be.empty;
        ctx.body = pt;
      } else {
        await next();
      }
    };

    (async function () {
      try{
        const res = await request.get('/restlet').expect(200);
        const restletPt = res.text;
        expect(restletPt).to.not.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('未登陆下, 配置restletIntegration, 命中规则, 乱设一个pgt在globalStore, 获取pt失败, 但能够自动重试并重新获取pgt, 但是再次获取pt还是失败, 直接退出不再重试', function(done) {
    globalPGTStore.set('demo1', 'some invalid pgt');
    let invalidPgt;

    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/restlet') {
        invalidPgt = globalPGTStore.get('demo1');
        expect(invalidPgt).to.equal('some invalid pgt');

        try {
          const pt = await ctx.getProxyTicket('invalid');
          const validPgt = globalPGTStore.get('demo1');
          expect(validPgt).to.not.equal(invalidPgt);
          ctx.body = pt;
        } catch (err) {
          ctx.status = 401;
          ctx.body = err.message || err;
        }
      } else {
        await next();
      }
    };

    (async function () {
      try{
        const res = await request.get('/restlet').expect(401);
        expect(res.text).to.not.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('未登录下, 配置restletIntegration, 且设置不缓存pgt,  命中规则, 不需要跳登陆, 且能够正确获取pt, 再次调用时, 获取到新的pgtId和pt', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
        casClientApp = new Koa();
        casClientFactory(casClientApp, {
          servicePrefix: clientPath,
          serverPath,
          paths: {
            restletIntegration: '/cas/v1/tickets',
          },
          restletIntegrationIsUsingCache: false,
          restletIntegration: {
            demo1: {
              trigger(ctx) {
                if (ctx.path.indexOf('restlet') > -1) return true;
              },
              params: {
                username: 'username',
                from: 'somewhere',
                type: 8,
                password: 'password',
              },
            },
          },
          logger,
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
        await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
        request = supertest.agent(casClientApp.listen());

        let pgt;

        hookAfterCasConfig = async function (ctx, next) {
          if (ctx.path === '/restlet') {
            if (ctx.query && ctx.query.time) {
              const cachedPgt = globalPGTStore.get('demo1');
              expect(cachedPgt).to.be.empty;
            }
            const pt = await ctx.getProxyTicket('some targetService');
            pgt = globalPGTStore.get('demo1');
            expect(pgt).to.be.empty;
            ctx.body = pt;
          } else {
            await next();
          }
        };

        let res = await request.get('/restlet').expect(200);
        expect(res.text).to.not.be.empty;
        const pt = res.text;
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/restlet?time=1').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        const secondPt = res.text;
        expect(secondPt).to.not.equal(pt);
        done();
      }catch(err){
        done(err);
      }
    })();
  });
});
