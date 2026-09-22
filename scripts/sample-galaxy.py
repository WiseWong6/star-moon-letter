"""读取底图中的亮星与星带走向；只分析像素，不修改图片。"""
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps
import json
import math

root = Path(__file__).resolve().parents[1]
image = Image.open(root / "assets/galaxy-sky.png").convert("RGB")
width, height = image.size
luma = ImageOps.grayscale(image)
local_max = luma.filter(ImageFilter.MaxFilter(5))
surrounding = luma.filter(ImageFilter.GaussianBlur(3))
cloud_light = luma.filter(ImageFilter.GaussianBlur(width * .022)).load()
light, maximum, background = luma.load(), local_max.load(), surrounding.load()
candidates = []
for y in range(int(height * .035), int(height * .6)):
    for x in range(int(width * .025), int(width * .975)):
        value = light[x, y]
        contrast = value - background[x, y]
        if value >= 55 and value == maximum[x, y] and contrast >= 25:
            candidates.append((contrast * .65 + value * .35, x, y, value))
candidates.sort(reverse=True)
stars = []
for score, x, y, value in candidates:
    px, py = x / width, y / height
    if any(math.hypot((px - star[0]) * 660, (py - star[1]) * 880) < 12 for star in stars):
        continue
    color = image.getpixel((x, y))
    scale = 255 / max(color)
    stars.append([round(px, 6), round(py, 6), *[round(v * scale) for v in color],
                  round(score / 255, 4), round(cloud_light[x, y] / 255, 4)])
    if len(stars) == 320:
        break
if len(stars) < 160:
    raise ValueError(f"只有 {len(stars)} 个有效亮星坐标，不能建立飞行落点")

# 从连续星云的亮度分布取中轴及两侧宽度，过滤单颗亮星造成的偏移。
# 只输出几何数据，页面渐显仍使用完整原图，不叠加一条人工光带。
cloud_profile = luma.filter(ImageFilter.GaussianBlur(width * .028)).load()
ridge = []
for i in range(33):
    x = min(width - 1, round(width * i / 32))
    column = [(y, max(0, cloud_profile[x, y] - 10) ** 1.6)
              for y in range(int(height * .08), int(height * .65))]
    total = sum(value for _, value in column)
    if not total:
        raise ValueError(f"底图横向 {i}/32 处无法提取星带走向")
    center = sum(y * value for y, value in column) / total
    accumulated, bounds = 0, []
    for y, value in column:
        accumulated += value
        if len(bounds) < 2 and accumulated >= total * [.12, .88][len(bounds)]:
            bounds.append(y)
    ridge.append([center, max(height * .045, center - bounds[0]),
                  max(height * .045, bounds[1] - center)])

# 平滑相邻位置的走向和宽窄，避免两侧展开时出现折痕。
smoothed_ridge = []
for i in range(len(ridge)):
    neighbors = [(j, math.exp(-.5 * ((j - i) / 1.25) ** 2))
                 for j in range(max(0, i - 4), min(len(ridge), i + 5))]
    weight = sum(value for _, value in neighbors)
    smoothed_ridge.append([round(i / 32, 6)] + [
        round(sum(ridge[j][axis] * value for j, value in neighbors) / weight / height, 6)
        for axis in range(3)])
output = root / "assets/galaxy-stars.js"
output.write_text("// 从 galaxy-sky.png 读取的亮星位置与颜色，不是星座目录。\n"
                  + "const GALAXY_STARS = " + json.dumps(stars, separators=(",", ":")) + ";\n"
                  + "// 横向位置、星带中轴高度、上侧宽度、下侧宽度，均按画幅归一化。\n"
                  + "const GALAXY_RIDGE = " + json.dumps(smoothed_ridge, separators=(",", ":")) + ";\n")
print(f"已读取 {len(stars)} 颗亮星坐标和 {len(smoothed_ridge)} 处星带走向，原图保持不变。")
