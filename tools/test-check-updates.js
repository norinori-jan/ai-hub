'use strict';
const assert = require('assert'), http = require('http');
const C = require('./check-updates.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
ok(C.normalize('<p>a</p><script>x()</script> <b>b</b>') === 'a b', 'normalize');
let body = '<html>料金 2970円</html>', code = 200;
const srv = http.createServer((q, r) => { r.statusCode = q.url === '/x' ? code : 404; r.end(body); }).listen(0, async () => {
  const u = 'http://127.0.0.1:' + srv.address().port, f = x => fetch(x);
  const S = [{ company: 'T', url: u + '/x', entries: ['e1'] }, { company: 'T', url: u + '/none', entries: [] }];
  let r = await C.check(S, {}, f, 1);
  ok(r.fresh.length === 1 && r.failed.length === 1, 'fresh+failed');
  let r2 = await C.check(S, r.state, f, 2);
  ok(r2.same.length === 1 && r2.changed.length === 0, 'same');
  body = '<html>料金 3135円</html>';
  let r3 = await C.check(S, r2.state, f, 3);
  ok(r3.changed.length === 1 && r3.state[u + '/x'].changedAt === 3, 'changed');
  ok(/変化あり: 1/.test(C.report(r3)) && /e1/.test(C.report(r3)), 'report');
  srv.close(); console.log('ALL PASSED ' + n);
});
