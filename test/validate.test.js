const Koa = require('koa');
//const co = require('co');
const supertest = require('supertest');
const { logger, hooks } = require('./lib/test-utils');
const { expect } = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');

describe('validate是否符合预期', function() {

  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;

  let casClientApp;
  let casClientServer;
  let casServerApp;
  let casServer;
  let serverRequest;
  let request;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;

  const casConfigHooks = {
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
  };

  beforeEach(function(done) {

    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      logger,
      hooks,
    }, casConfigHooks);

    (async function () {
      try{
        await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
        console.log(`casServer listen ${casPort}`);
        serverRequest = supertest.agent(casServerApp.listen());

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

  it('req.query中无ticket参数,302重定向到lastUrl', function(done) {
    (async function () {
      try{
        const res = await request.get('/cas/validate').expect(302);
        expect(res.header.location).to.equal('/');
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('req.query中带ticket参数,但是与session中的st一样, 302回lastUrl', function(done) {

    (async function () {
      try{
        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.equal('/');
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get(redirectLocation.replace(clientPath, '')).set('Cookie', handleCookies.getCookies(cookies)).expect(302);
        expect(res.header.location).to.equal('/');
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('校验ticket请求失败,响应非200,返回401', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

        casServerApp = new Koa();
        casServerFactory(casServerApp, {
          expectStatus: 500,
        });
        await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
        serverRequest = supertest.agent(casServerApp.listen());

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(401);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('校验ticket请求成功,但解析响应xml失败,返回500', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

        casServerApp = new Koa();
        casServerFactory(casServerApp, {
          expectStatusStr: 'invalid',
        });
        await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
        serverRequest = supertest.agent(casServerApp.listen());

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(500);
        const body = JSON.parse(res.text);
        expect(body.message).to.not.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('校验ticket请求成功,解析响应xml成功,但响应内容为非成功,响应401', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

        casServerApp = new Koa();
        casServerFactory(casServerApp, {
          expectStatusStr: 'fail',
        });
        await new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
        serverRequest = supertest.agent(casServerApp.listen());

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(401);
        const body = JSON.parse(res.text);
        expect(body.message).to.not.be.empty;
        expect(body.message.indexOf('validation is failed') !== -1).to.be.true;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('非代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,并直接302到lastUrl', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

        casClientApp = new Koa();
        casClientFactory(casClientApp, {
          servicePrefix: clientPath,
          serverPath,
          paths: {
            proxyCallback: '',
          },
          logger,
        }, casConfigHooks);
        await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
        request = supertest.agent(casClientApp.listen());

        hookAfterCasConfig = async function (ctx, next) {
          if (ctx.path === '/') {
            ctx.body = {
              sid: ctx.sessionId,
              cas: ctx.session.cas,
            };
          } else {
            return await next();
          }
        };

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.be.equal('/');
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        const body = res.body;
        expect(body.cas.user).to.not.be.empty;
        expect(body.cas.st).to.not.be.empty;
        expect(body.sid).to.not.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,但是没pgtIou,响应401');
  //
  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,但找不到pgtId,响应401');

  it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,找到pgtId,设置pgtId到session,302到lastUrl', function(done) {
    hookAfterCasConfig = async function (ctx, next) {
      if (ctx.path === '/') {
        ctx.body = {
          sid: ctx.sessionId,
          cas: ctx.session.cas,
        };
      } else {
        return await next();
      }
    };

    (async function () {
      try{
        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.be.equal('/');
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        const body = JSON.parse(res.text);
        expect(body.cas.user).to.not.be.empty;
        expect(body.cas.st).to.not.be.empty;
        expect(body.cas.pgt).to.not.be.empty;
        expect(body.sid).to.not.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('options.redirect工作正常', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

        casClientApp = new Koa();
        casClientFactory(casClientApp, {
          servicePrefix: clientPath,
          serverPath,
          paths: {
            proxyCallback: '',
          },
          redirect(ctx) { // eslint-disable-line
            return '/helloworld';
          },
          logger,
        });
        await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
        request = supertest.agent(casClientApp.listen());

        hookAfterCasConfig = async function (ctx, next) {
          if (ctx.pah === '/helloworld') {
            ctx.body = 'ok';
          } else {
            return await next();
          }
        };

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.be.equal('/helloworld');
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('hooks工作正常', function(done) {
    (async function () {
      try{
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

        casClientApp = new Koa();
        casClientFactory(casClientApp, {
          servicePrefix: clientPath,
          serverPath,
          paths: {
            proxyCallback: '',
          },
          logger,
          hooks: {
            async before(ctx) {
              ctx.start = Date.now();
            },
            async after(ctx) {
              expect(ctx.start).to.not.be.empty;
            },
          },
        });
        await new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
        request = supertest.agent(casClientApp.listen());

        let res = await serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
        const redirectLocation = res.header.location;

        res = await request.get(redirectLocation.replace(clientPath, '')).expect(302);
        expect(res.header.location).to.be.equal('/');
        done();
      }catch(err){
        done(err);
      }
    })();
  });

});
