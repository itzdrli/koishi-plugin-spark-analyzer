import { Context, Schema } from 'koishi'
import {confChecker, gcChecker} from './spark';
import fs from "fs";
import path from "path";

export const name = 'spark-analyzer'
export const using = ['puppeteer']
export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context) {
  const chotaStyles = fs.readFileSync(path.join(__dirname, 'chota.min.css'), 'utf-8');
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))
  ctx.i18n.define('en-US', require('./locales/en-US'))
  ctx.command('spark <url:strings>').action(async ({ session }, url) => {
    if (!url) {
      return session.text('nourl')
    }
    if (!url.startsWith('https://spark')) {
      return session.text('invalidurl')
    }
    const response_raw = await fetch(url + '?raw=1')
    const sampler: any = await response_raw.json().catch(() => undefined)
    if (!sampler) {
      return session.text('failed')
    }
    const cards: { name: string; value: string; }[] = []

    const platform = sampler.metadata.platform.version
    const user = sampler.metadata.user.name
    const configs = sampler.metadata.serverConfigurations
    let isServer: boolean = true
    if (!configs) isServer = false
    const plugins: { name: string; version: string }[] = Object.values(
      sampler.metadata.sources
    )
    const flags = sampler.metadata.systemStatistics.java.vmArgs
    const versionString = sampler.metadata.systemStatistics.java.vendorVersion
    const majorVersion = parseInt(versionString.split('.')[0], 10)

    let cardHTML = '';
    await Promise.all([
      confChecker(configs).then((fields) => cards.push(...fields)),
      gcChecker(flags, isServer, majorVersion).then((field) => cards.unshift(field))
    ]).then(() => {
      for (const card of cards) {
        cardHTML += `
      <div class="col-4">
        <div class="card">
          <h2>${card.name}</h2>
          <p>${card.value}</p>
        </div>
      </div>
    `;
      }
    })

    return `<html>
    <head>
      <style>
        ${chotaStyles}
        body {
          --font-color: #f5f5f5;
          background: linear-gradient(to right, #313436, #272a2b);
        }
        .card {
          background: linear-gradient(to right, #48494a, #4e4f52);
          box-shadow: 0 0.5em 1em -0.125em rgb(10 10 10 / 10%), 0 0 0 1px rgb(10 10 10 / 2%);
          border-radius: 15px;
        }
        .card h2 {
          color: #f5f5f5;
          text-shadow: 1px 1px 1px rgba(0,0,0,0.1);
          margin-bottom: 0.25rem;
          font-size: 1.25rem;
        }
        .card p {
          color: #f5f5f5;
          text-shadow: 1px 1px 1px rgba(0,0,0,0.1);
          margin-bottom: 1rem;
          font-size: 1.5rem;
        }
        .card .tag {
          color: #f5f5f5;
          font-size: 0.8rem;
        }
      </style>
    </head>
    <body>
      <div class="col-12">
         <div class="card">
            <h2>Spark - ${url.substring(url.lastIndexOf('\/') + 1)}</h2>
            <p>${platform} - ${user}</p>
            <div class="tag">本项目开源于 GitHub itzdrli/koishi-plugin-spark-analyzer</div>
            <div class="tag">项目代码基于大佬的代码进行修改 Github ahdg6/koishi-plugin-mcdev</div>
            <div class="tag">功能代码借鉴了 Discord bot - CraftyAssistant</div>
            <div class="tag">生成结果仅供参考</div>
         </div>
      </div>
      <div class="container">
        <div class="row">
          ${cardHTML}
        </div>
      </div>
    </body>
    </html>`
  })
}
