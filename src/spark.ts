import path from "path";
import fs from "fs";
import jexl from "jexl";

interface Checker {
  expressions?: string[];
  prefix: string;
  value: string;
}

const CHECKCONF = {
  bukkit: JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "analysis_config", "bukkit.json"),
      "utf8",
    ),
  ),
  spigot: JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "analysis_config", "spigot.json"),
      "utf8",
    ),
  ),
  server_properties: JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "analysis_config", "server.properties.json"),
      "utf8",
    ),
  ),
  purpur: JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "analysis_config", "purpur.json"),
      "utf8",
    ),
  ),
  paper: JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "analysis_config", "paper.json"),
      "utf8",
    ),
  ),
};
export async function confChecker(configs) {
  const fields: { name: string; value: string }[] = [];

  let variablesMap = {};

  const configKeys = [
    ["server.properties", "server_properties"],
    ["bukkit.yml", "bukkit"],
    ["spigot.yml", "spigot"],
    ["paper/", "paper"],
    ["purpur.yml", "purpur"],
  ];

  configKeys.forEach(([key, varName]) => {
    if (configs[key]) {
      variablesMap[varName] = JSON.parse(configs[key]);
    }
  });

  for (const name in variablesMap) {
    const configName = `config.${name}`;
    const configObj: any = await CHECKCONF[name];
    if (!configObj) continue;
    for (const nodePath in configObj) {
      const checkArray: Checker[] = configObj[nodePath];

      for (const checkItem of checkArray) {
        const { expressions } = checkItem;

        if (!expressions) continue;

        let allExpressionsTrue = true;

        for (const expressionStr of expressions) {
          try {
            const result = jexl.evalSync(expressionStr, variablesMap);

            if (!result) {
              allExpressionsTrue = false;
              break; // 如果有一个表达式不为真，我们可以直接退出循环
            }
          } catch (error) {
            fields.push(errorField(nodePath, error));
            allExpressionsTrue = false;
            break; // 出现错误时，我们也退出循环
          }
        }

        if (allExpressionsTrue) {
          fields.push(createField(nodePath, checkItem));
        }
      }
    }
  }

  return fields;
}

export async function gcChecker(
  jvmFlagsString: string,
  isServer: boolean,
  jvmVersion: number,
) {
  function extractMemoryAndGcType(
    jvmFlagString: string,
  ): [number | null, string | null] {
    const regex = /-Xm[sx]([0-9]+[kmg])\b.*?(-XX:\+Use(\w+)GC)\b/gi;
    const matches = regex.exec(jvmFlagString);
    if (matches && matches.length > 3) {
      const memorySizeStr = matches[1];
      const gcType = matches[3];

      const memorySize = parseMemorySize(memorySizeStr);

      return [memorySize, gcType];
    }

    return [null, null];
  }
  function parseMemorySize(memorySizeStr: string): number | null {
    const size = parseInt(memorySizeStr, 10);
    if (!isNaN(size)) {
      if (memorySizeStr.endsWith("g")) {
        return size * 1024; // GB 转换为 MB
      } else if (memorySizeStr.endsWith("k")) {
        return size / 1024; // KB 转换为 MB
      } else {
        return size; // MB
      }
    }
    return null;
  }
  const [memorySize, gcType] = extractMemoryAndGcType(jvmFlagsString);
  if (memorySize == null || gcType == null)
    return {
      name: '⚠️ 启动参数',
      value: '无法解析启动参数.'
    };
  if (gcType == 'Z' && memorySize <= 20480) {
    return {
      name: '❗ ZGC',
      value: `ZGC 在 20GB+ 运行内存的情况下才能发挥最大效果
        , 但是你只分配给了服务端 ${memorySize}MB, 所以建议加大内存或者使用GC.`
    };
  }
  if (gcType == 'Shenandoah' && isServer) {
    return {
      name: '❗ Shenandoah',
      value: `ShenandoahGC **不推荐** 在服务端上使用,
        ShenandoahGC 通常被用在Minecraft客户端上.`
    };
  }
  if (gcType == 'G1') {
    if (memorySize >= 20480 && jvmVersion >= 16) {
      return {
        name: '❗ G1 到 ZGC',
        value: `你在 Java${jvmVersion} 为服务端分配了 20GB+ 内存
            , 我建议你尝试使用 ZGC，因为它会极大地提高GC停止时间.`
      };
    }
    if (
      memorySize >= 12088 &&
      jvmFlagsString.includes('-XX:G1NewSizePercent=30')
    )
      return {
        name: '❗ G1 改进',
        value: `当你在 G1GC 中分配 12GB+ 内存时，请考虑更改一些标志值.`
      };
  }
  return {
    name: `✅ ${gcType}GC`,
    value: '干得好.在你的启动参数中，我们找不到任何问题.'
  };
}

function createField(node: string, option: Checker) {
  const field = { name: node, value: option.value };
  if (option.prefix) field.name = option.prefix + ' ' + field.name;
  return field;
}

function errorField(node: string, error: unknown) {
  return { name: '⚠️' + node, value: String(error) };
}
