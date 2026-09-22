"""生成固定秋季星空；仅制作时联网，页面直接读取生成的本地脚本。"""
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode
from datetime import datetime, timezone
import json, math

ROOT = Path(__file__).resolve().parent
RAD = math.pi / 180
LAT, LON = 22.5431, 114.0579
DATE = '2026-10-05T13:00:00+00:00'  # 深圳 21:00，UTC+8
CATALOG = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv?'+urlencode({
    '-source':'I/239/hip_main', '-out':'HIP,RAICRS,DEICRS,Vmag,pmRA,pmDE',
    '-out.max':'10000', 'Vmag':'<6.5', 'DEICRS':'0..70', '-sort':'Vmag'})
LINES = 'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json'
raw = urlopen(CATALOG, timeout=30).read().decode()
rows = []
for line in raw.splitlines():
    cells = line.split('\t')
    if len(cells)==6 and cells[0].strip().isdigit():
        rows.append(dict(zip(['hip','ra','dec','mag','pmRA','pmDE'],
            [int(cells[0])]+[float(v.strip() or 0) for v in cells[1:]])))
culture = json.load(urlopen(LINES, timeout=30))
groups=[]
for code, name in [('Cas','仙后座'),('And','仙女座'),('Peg','飞马座')]:
    item=next(c for c in culture['constellations'] if c['id'].split()[-1]==code)
    edges=[list(pair) for line in item['lines'] for pair in zip(line,line[1:])]
    ids=list(dict.fromkeys(i for pair in edges for i in pair))
    groups.append(dict(name=name,code=code,stars=ids,edges=edges))
anchor_ids=list(dict.fromkeys(i for group in groups for i in group['stars']))
by_id={s['hip']:s for s in rows}
assert all(i in by_id for i in anchor_ids)

def julian(date):
    return datetime.fromisoformat(date).timestamp()/86400+2440587.5

def current_equatorial(star, jd):
    # Hipparcos 的 ICRS 轴向近似 J2000；位置参考历元为 J1991.25。
    years=(jd-(2451545+(1991.25-2000)*365.25))/365.25
    ra=(star['ra']+star['pmRA']*years/(3600000*math.cos(star['dec']*RAD)))*RAD
    dec=(star['dec']+star['pmDE']*years/3600000)*RAD
    # IAU 1976 从 J2000 到观测日期的岁差；画面级精度不计章动、折射及周年光行差。
    t=(jd-2451545)/36525
    zeta=(2306.2181*t+.30188*t*t+.017998*t*t*t)/3600*RAD
    z=(2306.2181*t+1.09468*t*t+.018203*t*t*t)/3600*RAD
    theta=(2004.3109*t-.42665*t*t-.041833*t*t*t)/3600*RAD
    a=math.cos(dec)*math.sin(ra+zeta)
    b=math.cos(theta)*math.cos(dec)*math.cos(ra+zeta)-math.sin(theta)*math.sin(dec)
    c=math.sin(theta)*math.cos(dec)*math.cos(ra+zeta)+math.cos(theta)*math.sin(dec)
    return math.atan2(a,b)+z,math.asin(c)

def horizontal(star,date):
    jd=julian(date); jd0=math.floor(jd-.5)+.5; hours=(jd-jd0)*24
    t=(jd-2451545)/36525
    # 美国海军天文台的近似平恒星时公式；UTC 近似 UT1。
    gmst=(6.697375+.065709824279*(jd0-2451545)+1.0027379*hours+.0000258*t*t)%24
    ra,dec=current_equatorial(star,jd); hour=(gmst*15+LON)*RAD-ra; lat=LAT*RAD
    east=-math.cos(dec)*math.sin(hour)
    north=math.sin(dec)*math.cos(lat)-math.cos(dec)*math.cos(hour)*math.sin(lat)
    up=math.sin(dec)*math.sin(lat)+math.cos(dec)*math.cos(hour)*math.cos(lat)
    return (east,north,up)

def dot(a,b): return sum(x*y for x,y in zip(a,b))
def unit(v): return tuple(x/math.sqrt(dot(v,v)) for x in v)
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])

# 同一视点、同一投影和等比缩放；绝不逐个挪动或旋转星座。
vectors=[horizontal(by_id[i],DATE) for i in anchor_ids]
center=unit(tuple(sum(v[k] for v in vectors) for k in range(3)))
up=unit(tuple((1 if k==2 else 0)-center[2]*center[k] for k in range(3)))
right=unit(cross(center,up))
def project(star):
    v=horizontal(star,DATE); denominator=1+dot(v,center)
    return 2*dot(v,right)/denominator,-2*dot(v,up)/denominator
anchors=[project(by_id[i]) for i in anchor_ids]
lo=[min(p[k] for p in anchors) for k in range(2)]; hi=[max(p[k] for p in anchors) for k in range(2)]
scale=min(540/(hi[0]-lo[0]),420/(hi[1]-lo[1]))
offset=(330-(hi[0]+lo[0])*.5*scale,280-(hi[1]+lo[1])*.5*scale)
def placed(star):
    x,y=project(star); v=horizontal(star,DATE)
    return dict(star,x=round(x*scale+offset[0],5),y=round(y*scale+offset[1],5),
        altitude=round(math.degrees(math.asin(v[2])),5),azimuth=round(math.degrees(math.atan2(v[0],v[1]))%360,5))
selected=[placed(by_id[i]) for i in anchor_ids]
# 辅星也取真实目录。仅省略视场外及无法分辨的密邻星，不挪动位置。
for star in sorted(rows,key=lambda s:(s['mag'],s['hip'])):
    if star['hip'] in anchor_ids: continue
    p=placed(star)
    if not(35<p['x']<625 and 45<p['y']<505 and p['altitude']>10):continue
    if any(math.hypot(p['x']-q['x'],p['y']-q['y'])<5 for q in selected):continue
    selected.append(p)
    if len(selected)==120:break
assert len(selected)==120
checks={}
for date in ['2026-09-25T13:00:00+00:00',DATE,'2026-10-15T13:00:00+00:00']:
    checks[date]={}
    for group in groups:
        alt=[math.degrees(math.asin(horizontal(by_id[i],date)[2])) for i in group['stars']]
        assert min(alt)>15
        checks[date][group['name']]=[round(min(alt),1),round(max(alt),1)]
output=dict(observer=dict(city='深圳',latitude=LAT,longitude=LON,localTime='2026-10-05 21:00 UTC+8'),
    view=dict(azimuth=round(math.degrees(math.atan2(center[0],center[1]))%360,2),altitude=round(math.degrees(math.asin(center[2])),2),projection='stereographic',up='local zenith',scale=scale,offset=offset),
    source='ESA 1997 Hipparcos, I/239/hip_main; Stellarium modern line figures (CC BY-SA 4.0)',
    constellations=groups,anchorCount=len(anchor_ids),stars=selected,visibility=checks)
(ROOT/'autumn-sky.js').write_text('// 恒星坐标：ESA Hipparcos。连线改编：Stellarium team，CC BY-SA 4.0。详见 SKY-SOURCES.md。\nconst AUTUMN_SKY = '+json.dumps(output,ensure_ascii=False,separators=(',',':'))+';\n')
print(json.dumps({'view':output['view'],'anchors':len(anchor_ids),'groups':[(g['name'],len(g['stars']),len(g['edges'])) for g in groups],'visibility':checks},ensure_ascii=False,indent=2))
