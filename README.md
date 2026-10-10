# 资产配置看板 · portfolio-dashboard

个人资产分布可视化（美股 / A股 / 数字货币 / 现金），静态单页，数据存于浏览器 `localStorage`。

## 访问

- GitHub Pages：见仓库 Pages 地址
- **本地通行码门禁**（非真正私有托管）：GitHub Pages 无法免费做服务端鉴权。页面仅用浏览器 `sessionStorage` 校验通行码，知道通行码即可查看。

## 价格来源

- 美股：优先 `stockprices.dev`，其次 Nasdaq 公开报价接口（与 tesla-dashboard 同源；浏览器可能因 CORS 失败），再回退 `quotes.json`
- BTC：CoinGecko → Binance
- 汇率 USD/CNY：Frankfurter → open.er-api

本地可运行 `python3 refresh_quotes.py` 更新 `quotes.json`（Nasdaq）。

## 免责声明

仅供个人资产分布可视化，不构成投资建议。
