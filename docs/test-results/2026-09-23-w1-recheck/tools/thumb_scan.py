import subprocess, sys
from collections import Counter
FF = r"C:/Users/ting/ffmpeg-8.0-full_build/bin/ffmpeg.exe"
png = sys.argv[1]; y0=int(sys.argv[2]); y1=int(sys.argv[3])
W,H = 1080,2412
raw = subprocess.run([FF,"-v","error","-i",png,"-f","rawvideo","-pix_fmt","rgb24","-"],capture_output=True).stdout
def px(x,y):
    o=(y*W+x)*3; return raw[o],raw[o+1],raw[o+2]
def sat(x,y,th=25):
    r,g,b=px(x,y); return max(r,g,b)-min(r,g,b)>th
runs={}
for x in range(60,1020):
    ys=[y for y in range(y0,y1) if sat(x,y)]
    if ys: runs[x]=max(ys)-min(ys)+1
cnt=Counter(runs.values())
print("run-length histogram:", sorted(cnt.items()))
mx=max(runs.values())
xs=[x for x,v in runs.items() if v==mx]
print("max run=%d px at x=%d..%d" % (mx,min(xs),max(xs)))
# 手柄中心列附近的竖直彩色范围
cx=(min(xs)+max(xs))//2
ys=[y for y in range(y0,y1) if sat(cx,y)]
print("thumb column x=%d: y=%d..%d -> %d px" % (cx,min(ys),max(ys),max(ys)-min(ys)+1))
# 轨道厚度：取远离手柄的列
tx=900
ys2=[y for y in range(y0,y1) if sat(tx,y)]
print("track column x=%d: y=%d..%d -> %d px" % (tx,min(ys2),max(ys2),max(ys2)-min(ys2)+1))
print("samples rgb: thumb=(%d,%d,%d) track_active=(%d,%d,%d) track_inactive=(%d,%d,%d)" % (
    px(cx,(min(ys)+max(ys))//2)+px(200,(min(ys2)+max(ys2))//2)+px(700,(min(ys2)+max(ys2))//2)))
