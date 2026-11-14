/** Accessible, responsive business-facing dashboard theme. No JS, remote assets or dependencies. */
export const businessTheme = `<style>
:root{color-scheme:light;--ink:#17263b;--muted:#617186;--line:#dce5ed;--blue:#2359c5;--bg:#f4f7fb;--white:#fff}
*{box-sizing:border-box}body{font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);margin:0;max-width:none;padding:0}
main{max-width:1240px;margin:0 auto;padding:32px 24px 72px}
header{background:#102442;color:#fff;padding:24px max(24px,calc((100vw - 1192px)/2))}
header h1{font-size:25px;margin:0}header p{color:#cfdaed;margin:4px 0 0}
nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}nav a{border:1px solid var(--line);background:var(--white);border-radius:9px;padding:9px 14px;text-decoration:none;font-weight:600}
nav a:hover,nav a:focus-visible{border-color:var(--blue);outline-offset:3px}
a{color:var(--blue)}h2{font-size:19px;margin:28px 0 12px}
.intro{font-size:17px;color:var(--muted);max-width:750px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:14px;margin:24px 0}
.kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 3px 14px #12274308}
.kpi strong{display:block;font-size:32px;line-height:1.2;font-variant-numeric:tabular-nums}.kpi span{display:block;color:var(--muted);margin-top:7px}
section,.surface{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;margin:20px 0;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:14px 12px;text-align:left;vertical-align:top}th{background:#f7f9fc;color:#43556d;font-weight:650}tr:last-child td{border-bottom:0}
form{display:flex;gap:10px;flex-wrap:wrap;align-items:center}button{background:var(--blue);border:0;color:#fff;padding:10px 14px;border-radius:8px;cursor:pointer;font-weight:650}button[value="rejected"]{background:#64748b}button:hover{filter:brightness(.93)}
input{border:1px solid #b9c8d7;border-radius:7px;padding:9px;max-width:180px}
aside{background:#eaf1fb;border-left:4px solid var(--blue);padding:16px 18px;border-radius:9px;margin:18px 0}
small,.muted{color:var(--muted)}.pill{display:inline-block;background:#eaf1fb;color:#244b85;padding:3px 9px;border-radius:100px;font-size:12px;font-weight:700}
@media(max-width:700px){main{padding:20px 14px 48px}header{padding:22px 16px}section,.surface{padding:14px}table{min-width:620px}.kpi strong{font-size:26px}}
</style>`;
