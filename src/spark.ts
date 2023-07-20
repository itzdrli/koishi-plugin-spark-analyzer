import path from 'path'
import yaml from 'js-yaml'
import fs from "fs";
import jexl from 'jexl';

interface Checker {
  expressions?: string[]
  prefix: string
  value: string
}

const CHECKCONF = {
  bukkit: yaml.load(fs.readFileSync(path.join(__dirname, 'analysis_config', 'bukkit.yml'), 'utf8')),
  spigot: yaml.load(fs.readFileSync(path.join(__dirname, 'analysis_config', 'spigot.yml'), 'utf8')),
  server_properties: yaml.load(fs.readFileSync(path.join(__dirname, 'analysis_config', 'server.properties.yml'), 'utf8')),
  purpur: yaml.load(fs.readFileSync(path.join(__dirname, 'analysis_config', 'purpur.yml'), 'utf8')),
  paper: yaml.load(fs.readFileSync(path.join(__dirname, 'analysis_config', 'paper.yml'), 'utf8')),
}
export async function confChecker(configs){
  const fields: { name: string; value: string; }[] = []

  let variablesMap = {}

  const configKeys = [
    ['server.properties', 'server_properties'],
    ['bukkit.yml', 'bukkit'],
    ['spigot.yml', 'spigot'],
    ['paper/', 'paper'],
    ['purpur.yml', 'purpur']
  ]

  configKeys.forEach(([key, varName]) => {
    if (configs[key]) {
      variablesMap[varName] = JSON.parse(configs[key])
    }
  })

  for (const name in variablesMap) {
    const configName = `config.${name}`
    const configObj: any = await CHECKCONF[name]
    if (!configObj) continue
    for (const nodePath in configObj) {
      const checkArray: Checker[] = configObj[nodePath]
      for (let i = 0; i < checkArray.length; i++) {
        let expressions = checkArray[i].expressions
        // @ts-ignore
        const allExpressionsTrue = expressions.every(
          async (expressionStr) => {
            try {
              const result = await jexl.eval(expressionStr, variablesMap)
              return !!result
            } catch (error) {
              fields.push(errorField(nodePath, error))
              return false
            }
          }
        )
        if (allExpressionsTrue)
          fields.push(createField(nodePath, checkArray[i]))
      }
    }
  }

  return fields
}

export async function gcChecker(
  jvmFlagsString: string,
  isServer: boolean,
  jvmVersion: number
) {
  function extractMemoryAndGcType(
    jvmFlagString: string
  ): [number | null, string | null] {
    const regex = /-Xm[sx]([0-9]+[kmg])\b.*?(-XX:\+Use(\w+)GC)\b/gi
    const matches = regex.exec(jvmFlagString)
    if (matches && matches.length > 3) {
      const memorySizeStr = matches[1]
      const gcType = matches[3]

      const memorySize = parseMemorySize(memorySizeStr)

      return [memorySize, gcType]
    }

    return [null, null]
  }
  function parseMemorySize(memorySizeStr: string): number | null {
    const size = parseInt(memorySizeStr, 10)
    if (!isNaN(size)) {
      if (memorySizeStr.endsWith('g')) {
        return size * 1024 // GB 转换为 MB
      } else if (memorySizeStr.endsWith('k')) {
        return size / 1024 // KB 转换为 MB
      } else {
        return size // MB
      }
    }
    return null
  }
  const [memorySize, gcType] = extractMemoryAndGcType(jvmFlagsString)
  if (memorySize == null || gcType == null)
    return {
      name: '⚠️ Flags',
      value: 'We can not analyse your flags.'
    }
  if (gcType == 'Z' && memorySize <= 20480) {
    return {
      name: '❗ ZGC',
      value: `ZGC is known to be usable when you allocated 20GB+ Memory
        , But you only allocated ${memorySize}MB so increase it or change GC (Use /mcflags to generate one).`
    }
  }
  if (gcType == 'Shenandoah' && isServer) {
    return {
      name: '❗ Shenandoah',
      value: `ShenandoahGC is **Not** server friendly,
        It only works well on client side. Use our /mcflags to generate better one.`
    }
  }
  if (gcType == 'G1') {
    if (memorySize >= 20480 && jvmVersion >= 16) {
      return {
        name: '❗ G1 to ZGC',
        value: `You are allocating 20GB+ in Java${jvmVersion}
            , I would like to recommend you hava a try with ZGC as It will greatly improve your GC stop time.`
      }
    }
    if (
      memorySize >= 12088 &&
      jvmFlagsString.includes('-XX:G1NewSizePercent=30')
    )
      return {
        name: '❗ G1 Improvement',
        value: `When you allocated 12GB+ memory
        in G1GC, Please consider changing some flags value. (Use /mcflags to generate)`
      }
  }
  return {
    name: `✅ ${gcType}GC`,
    value: 'Good job. We can not find any problems in your flags.'
  }
}

function createField(node: string, option: Checker) {
  const field = { name: node, value: option.value }
  if (option.prefix) field.name = option.prefix + ' ' + field.name
  return field
}

function errorField(node: string, error: unknown) {
  return { name: '⚠️' + node, value: String(error) }
}
