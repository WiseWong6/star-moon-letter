> 历史版本资料：当前页面已改为无星座连线的艺术星河，不加载此目录的数据。

# 真实秋季星空的数据与取景

## 取景

- 地点：深圳，北纬 22.5431°，东经 114.0579°。
- 代表时刻：2026-10-05 21:00，UTC+8；当前固定画面，不随电脑日期变化。
- 连线：仙后座 5 星、仙女座 6 星、飞马座轮廓 14 星，其中 HIP 677 共用，合计 24 颗不同恒星、23 段连线。
- 共 120 颗目录恒星：56 颗作为飞行落点，其中前 24 颗为连线主星；其余 64 颗渐显为背景。星表筛选会省略视场外与过近的辅星，不人为移动坐标。
- 所有星点使用同一个立体投影，画面上方指向当地天顶，整体等比缩放。视线中心方位角 59.64°、仰角 61.76°。保留整个视场的方位关系，不单独排版星座。
- 恒星真实坐标与相对亮度有数据依据；连线只是辨认辅助，不是天空中实际存在的光线。

## 来源与署名

1. 恒星坐标、目视星等、自行：**ESA, 1997, The Hipparcos and Tycho Catalogues, ESA SP-1200**，目录 `I/239/hip_main`。使用 HIP、RAICRS、DEICRS、Vmag、pmRA、pmDE 六个字段。
   - [ESA 官方目录说明](https://www.cosmos.esa.int/web/hipparcos/catalogues)
   - [CDS 原始目录入口](https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239)
   - 数据通过 VizieR 取得；致谢：CDS, Strasbourg, France，服务 DOI：[10.26093/cds/vizier](https://doi.org/10.26093/cds/vizier)。
2. 星座连线：改编自 **Stellarium's team** 的 Modern sky culture，**CC BY-SA 4.0**。仅提取三个星座的 HIP 连线关系，未使用插画。
   - [原始连线数据](https://github.com/Stellarium/stellarium/blob/master/skycultures/modern/index.json)
   - [原始作者及许可声明](https://github.com/Stellarium/stellarium/blob/master/skycultures/modern/description.md#license)
   - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，完整许可附于 `CC-BY-SA-4.0.txt`。本目录中改编的连线数据遵循相同许可；再分发时保留署名、来源、许可与改编说明。
3. 季节核对：[香港太空馆《四季星空》](https://hk.space.museum/tc/web/spm/resources/teachers-corner/starry-sky-of-the-four-seasons.html)，以及香港天文台 [2026 年 9 月星图](https://www.hko.gov.hk/en/gts/astron2026/files/2026sky09.pdf)、[10 月星图](https://www.hko.gov.hk/en/gts/astron2026/files/2026sky10.pdf)资料入口。香港与深圳纬度相近；最终可见性由深圳坐标计算验证。
4. 方位计算参考美国海军天文台的[近似恒星时公式](https://aa.usno.navy.mil/faq/GAST)及[高度和方位公式](https://aa.usno.navy.mil/faq/alt_az)。岁差采用 IAU 1976 公式，系数与 [ERFA 参考实现](https://github.com/liberfa/erfa/blob/master/src/prec76.c)核对。没有引入天文运行库。

## 计算与适用范围

Hipparcos 位置历元为 J1991.25、坐标轴为 ICRS。先以目录自行推算到观测日期，再以 J2000 轴向近似及 IAU 1976 岁差转换至当日赤道坐标，由当地恒星时和纬度计算地平坐标，最后统一投影。

UTC 近似 UT1，省略章动、周年光行差、大气折射和恒星径向运动。适合本画幅的星空图形展示，不作为望远镜指向或观测测量工具。实际肉眼可见程度仍受月光、天气和灯光影响；没有模拟这些条件，也未绘制行星与月亮。

`autumn-sky.js` 包含所选星的原始数值、计算出的屏幕落点、仰角和方位，以及三个代表日期的主星仰角范围，便于复核。`build-autumn-sky.py` 是本次数据生成脚本，仅重新生成时需要联网；页面直接加载已经保存的本地数据，无需服务器。
