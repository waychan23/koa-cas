const Koa = require('koa');
//const co = require('co');
const supertest = require('supertest');
const { logger, hooks } = require('./lib/test-utils');
const { expect } = require('chai');
const casClientFactory = require('./lib/casClientFactory');
const PTStore = require('../lib/ptStroe');
const handleCookies = require('./lib/handleCookie');

describe('PTStore功能正常', function() {

  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;
  const ptKey = 'key';
  const ptValue = 'I am a pt';

  let casClientApp;
  let casClientServer;
  let request;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;
  let ptStore;

  beforeEach(function(done) {

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      logger,
      hooks,
    }, {
      beforeCasConfigHook(app) {
        console.log('beforeCasConfigHook, app: ', app);
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

    hookBeforeCasConfig = async function (ctx, next) {
      console.log('hookBeforeCasConfig');
      ctx.sessionSave = true; // 确保创建一个session, 在cookie中存储sessionid
      switch (ctx.path) {
        case '/get':
          ctx.body = (await ptStore.get(ctx, ptKey)) || '';
          break;
        case '/set':
          ctx.body = (await ptStore.set(ctx, ptKey, ptValue)) || '';
          break;
        case '/remove':
          await ptStore.remove(ctx, ptKey);
          ctx.body = 'ok';
          break;
        case '/clear':
          await ptStore.clear(ctx);
          ctx.body = 'ok';
          break;
        default:
          return await next();
      }
    };

    (async function () {
      try{
        console.log('beforeEach');
        await new Promise((r, j) => {
          casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r());
        });
        console.log(`casClientServer listen ${clientPort}`);
        request = supertest.agent(casClientServer);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  afterEach(function(done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    (async function() {
      try{
        console.log('afterEach: casClientServer: ', !!casClientServer);
        await new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('未初始化, 直接get, remove, clear, 不会出现异常', function(done) {
    ptStore = new PTStore({
      logger() {
        return () => {};
      },
    });

    (async function () {
      try{
        let res = await request.get('/get').expect(200);
        console.log('after get /');
        expect(res.text).to.be.empty;
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/remove').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;

        res = await request.get('/clear').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('set后, 在过期时间内, 可以正常获取', function(done) {
    ptStore = new PTStore();

    (async function () {
      try{
        let res = await request.get('/set').expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('set后, 立刻获取能够获取, 但超过过期时间, 无法获取', function(done) {
    ptStore = new PTStore({
      ttl: 1000,
    });

    (async function () {
      try{
        let res = await request.get('/set').expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);
        const cookies = handleCookies.setCookies(res.header);

        await new Promise((r) => setTimeout(() => r(), 500));
        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);

        await new Promise((r) => setTimeout(() => r(), 1000));
        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.be.empty;

        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('remove后, 无论存不存在都正常响应, 删除后get不到该pt', function(done) {
    ptStore = new PTStore();

    (async function () {
      try{
        let res = await request.get('/set').expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);

        res = await request.get('/remove').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.equal('ok');

        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

  it('clear后, 啥都获取不到', function(done) {
    ptStore = new PTStore();

    (async function () {
      try{
        let res = await request.get('/set').expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);
        const cookies = handleCookies.setCookies(res.header);

        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.not.be.empty;
        expect(res.text).to.equal(ptValue);

        res = await request.get('/clear').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.equal('ok');

        res = await request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
        expect(res.text).to.be.empty;
        done();
      }catch(err){
        done(err);
      }
    })();
  });

});
