import { PassThrough } from "stream";
import path from "path";
import _ from "lodash";
import mime from "mime";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import crypto from "crypto";
import CRC32 from "crc-32";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { createParser } from "eventsource-parser";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";

// 配置axios代理
if (process.env.PROXY) {
  const proxyUrl = new URL(process.env.PROXY);
  axios.defaults.proxy = {
    host: proxyUrl.hostname,
    port: parseInt(proxyUrl.port),
    auth: proxyUrl.username ? {
      username: proxyUrl.username,
      password: proxyUrl.password
    } : undefined,
    protocol: proxyUrl.protocol
  };
}

// 模型名称
const MODEL_NAME = "jimeng";
// 默认的AgentID（海外）
const DEFAULT_ASSISTANT_ID = "513641"; 
// CN 站点 AgentID
const CN_ASSISTANT_ID = "513695";
// 版本号
const VERSION_CODE = "5.8.0";
// App SDK 版本
const APP_SDK_VERSION = "48.0.0";
// 平台代码
const PLATFORM_CODE = "7";
// 设备ID
const DEVICE_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// WebID
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// 用户ID
const USER_ID = util.uuid(false);

type RegionConfig = {
  countryCode: string; // e.g. US, EG
  webIdc?: string;     // e.g. useast5, sg1
  regionKey?: string;  // parsed from web_domain, e.g. us, sg
  mwebHost?: string;   // resolved API host for /mweb/* endpoints
  webDomain?: string;
  commerceDomain?: string;
  frontierDomain?: string;
  ttsDomain?: string;
};
const REGION_CFG_MAP = new Map<string, RegionConfig>();
export function getRegionConfig(refreshToken: string): RegionConfig | null {
  // 检查是否有 CN 后缀（如 token:cn）
  const { region: tokenRegion } = parseTokenRegion(refreshToken);
  if (tokenRegion && tokenRegion.toUpperCase() === "CN") {
    return {
      countryCode: 'CN',
      webIdc: 'cn1',
      regionKey: 'cn',
      mwebHost: 'https://jimeng.jianying.com',
      webDomain: 'https://jimeng.jianying.com',
      commerceDomain: 'https://jimeng.jianying.com',
      frontierDomain: undefined,
      ttsDomain: undefined,
    };
  }
  
  // 非CN区域：从缓存中获取，如果没有则返回默认 US 配置
  const cfg = REGION_CFG_MAP.get(refreshToken);
  if (cfg) return cfg;
  
  // Fallback: 默认 US 配置（等待 user_info 更新）
  return {
    countryCode: 'US',
    webIdc: 'useast5',
    regionKey: 'us',
    mwebHost: 'https://dreamina-api.us.capcut.com',
    webDomain: undefined,
    commerceDomain: 'https://commerce.us.capcut.com',
    frontierDomain: 'wss://frontier.us.capcut.com',
    ttsDomain: 'wss://web-edit.us.capcut.com',
  };
}
// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;
// 伪装headers
const FAKE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-language": "zh-CN,zh;q=0.9",
  "App-Sdk-Version": APP_SDK_VERSION,
  "Cache-control": "no-cache",
  "Content-Type": "application/json",
  "Last-event-id": "undefined",
  Appid: DEFAULT_ASSISTANT_ID,
  Appvr: VERSION_CODE,
  Origin: "https://dreamina.capcut.com",
  Pragma: "no-cache",
  Priority: "u=1, i",
  Referer: "https://dreamina.capcut.com/",
  Pf: PLATFORM_CODE,
  "Sec-Ch-Ua":
    '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  // "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Site": "same-site",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};
// 文件最大大小
const FILE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * 获取缓存中的access_token
 *
 * 目前jimeng的access_token是固定的，暂无刷新功能
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function acquireToken(refreshToken: string): Promise<string> {
  // 直接返回传入的 sessionid
  return refreshToken;
}

/**
 * 生成 verifyFp 指纹参数
 * 格式: verify_{timestamp36}_{uuid}
 */
function generateVerifyFp(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
  const charsLen = chars.length;
  const uuid: string[] = [];
  
  // 固定位置的字符
  uuid[8] = uuid[13] = uuid[18] = uuid[23] = "_";
  uuid[14] = "4";
  
  // 随机填充其他位置
  for (let i = 0; i < 36; i++) {
    if (!uuid[i]) {
      const randomIdx = Math.floor(Math.random() * charsLen);
      // 第19位特殊处理
      uuid[i] = chars[i === 19 ? (randomIdx & 0x3 | 0x8) : randomIdx];
    }
  }
  
  // 时间戳转36进制
  const timestamp36 = Date.now().toString(36);
  
  // 组合最终指纹
  return `verify_${timestamp36}_${uuid.join('')}`;
}

/**
 * 对邮箱进行哈希
 * @param email 邮箱地址
 * @returns SHA256 哈希值
 */
function hashEmail(email: string): string {
  const salt = "aDy0TUhtql92P7hScCs97YWMT-jub2q9";
  return crypto.createHash("sha256")
    .update(email + salt)
    .digest("hex");
}

/**
 * 解析 token，支持多种格式：
 * 1. base64(邮箱,sessionid) - 推荐格式
 * 2. email:token 或 token:email - 兼容格式
 * 3. token - 纯 token 格式
 */
function parseTokenWithEmail(refreshToken: string): { token: string; email?: string } {
  // 尝试 base64 解码（推荐格式）
  try {
    const decoded = Buffer.from(refreshToken, 'base64').toString('utf-8');
    // 检查是否为 "邮箱,sessionid" 格式
    if (decoded.includes(',') && decoded.includes('@')) {
      const commaIndex = decoded.indexOf(',');
      const email = decoded.substring(0, commaIndex);
      const token = decoded.substring(commaIndex + 1);
      // 验证邮箱格式
      if (email.includes('@') && token.length > 0) {
        return { token, email };
      }
    }
  } catch (e) {
    // 解码失败，继续尝试其他格式
  }
  
  // 兼容旧格式：email:token 或 token:email
  const parts = refreshToken.split(":");
  if (parts.length >= 2) {
    // 检查哪个部分像邮箱
    if (parts[0].includes("@")) {
      return { token: parts[1], email: parts[0] };
    } else if (parts[1].includes("@")) {
      return { token: parts[0], email: parts[1] };
    }
  }
  
  // 默认：纯 token 格式
  return { token: refreshToken };
}

/**
 * 通过 passport/web/region 接口快速获取 msToken、toIdc 和 countryCode
 * 这个接口主要用于获取 msToken 和 IDC 信息，速度更快
 * 
 * @param refreshToken refresh token (支持多种格式)
 * @returns 返回 { msToken, toIdc, countryCode } 或 null
 */
async function fetchMsTokenAndIdc(refreshToken: string): Promise<{ msToken?: string; toIdc?: string; countryCode?: string } | null> {
  try {
    const { token: baseToken, email } = parseTokenWithEmail(refreshToken);
    
    // 如果没有提供邮箱，使用默认占位邮箱
    const emailToUse = email || "guest@capcut.com";
    const hashedId = hashEmail(emailToUse.toLowerCase().trim());
    const verifyFp = generateVerifyFp();
    
    // 使用官方域名 login.us.capcut.com
    const url = new URL("https://login.us.capcut.com/passport/web/region/");
    url.searchParams.set("aid", DEFAULT_ASSISTANT_ID);
    url.searchParams.set("account_sdk_source", "web");
    url.searchParams.set("sdk_version", "2.1.10-tiktok");
    url.searchParams.set("language", "en");
    url.searchParams.set("verifyFp", verifyFp);
    url.searchParams.set("mix_mode", "1");

    const headers = {
      ...FAKE_HEADERS,
      "accept": "application/json, text/plain, */*",
      "appid": DEFAULT_ASSISTANT_ID,
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "origin": "https://dreamina.capcut.com",
      "referer": "https://dreamina.capcut.com/",
      "did": String(DEVICE_ID),
      "store-country-code-src": "cdn"
    } as Record<string, string>;
    
    logger.info(`🌍 通过 passport/web/region 获取信息... (email: ${emailToUse})`);
    
    const resp = await axios.request({
      method: "POST",
      url: url.toString(),
      data: `type=2&hashed_id=${hashedId}`,
      headers,
      timeout: 15000,
      validateStatus: () => true,
    });
    
    if (resp.status !== 200 || resp.data?.message !== "success") {
      logger.warn(`passport/web/region 请求失败: ${resp.status} ${JSON.stringify(resp.data)}`);
      return null;
    }
    
    // 从响应数据提取 country_code
    const data = resp.data?.data;
    const countryCode = (data?.country_code || "").toLowerCase() || "us";
    
    // 从响应头提取 to-idc (如 sg1, useast5, alisg)
    const toIdc = resp.headers?.["to-idc"] || undefined;
    
    // 从 Set-Cookie 提取 msToken
    let msToken: string | undefined;
    const setCookies = resp.headers?.["set-cookie"] as string[] | undefined;
    if (setCookies && setCookies.length) {
      const msTokenPair = setCookies
        .flatMap((sc) => sc.split(";"))
        .find((kv) => kv.trim().startsWith("msToken="));
      if (msTokenPair) {
        msToken = msTokenPair.trim().split("=")[1];
        logger.info(`✅ msToken 已获取: ${msToken.substring(0, 20)}...`);
      }
    }
    
    if (toIdc) {
      logger.info(`✅ toIdc 已获取: ${toIdc}`);
    }
    
    if (countryCode) {
      logger.info(`✅ countryCode 已获取: ${countryCode}`);
    }
    
    return { msToken, toIdc, countryCode };
  } catch (err) {
    logger.warn("passport/web/region 请求失败:", err);
    return null;
  }
}

/**
 * 生成cookie
 * 海外区域使用优化的 cookie 组合: sessionid + cc-target-idc
 * CN 区域使用 jimeng-free-api 的 cookie 格式
 */
export function generateCookie(refreshToken: string, region?: string) {
  // 解析 token，提取纯 sessionid 和区域后缀
  const { token: sessionId, region: tokenRegion } = parseTokenRegion(refreshToken);
  const finalRegion = tokenRegion || region || "";
  const regionUpper = finalRegion.toUpperCase();

  // CN 区域：使用 jimeng-free-api 的 cookie 格式
  if (regionUpper === "CN") {
    const cookieParts = [
      `_tea_web_id=${WEB_ID}`,
      `is_staff_user=false`,
      `uid_tt=${USER_ID}`,
      `uid_tt_ss=${USER_ID}`,
      `sid_tt=${sessionId}`,
      `sessionid=${sessionId}`,
      `sessionid_ss=${sessionId}`,
      `store-region=cn-gd`,
      `store-region-src=uid`,
    ];
    return cookieParts.join("; ");
  }

  // 非CN区域：使用优化的 cookie 组合
  // sessionid + cc-target-idc 是必需的
  // 所有非CN区域固定使用 useast5
  const cookieParts = [
    `sessionid=${sessionId}`,
    `sessionid_ss=${sessionId}`,
    `cc-target-idc=useast5`,
  ];

  return cookieParts.join("; ");
}

export async function ensureMsToken(refreshToken: string) {
  // CN 区域：通过 token 后缀识别，不调用 user_info
  const { region: overrideRegion } = parseTokenRegion(refreshToken);
  if (overrideRegion && overrideRegion.toUpperCase() === "CN") {
    return; // CN 区域不需要调用 user_info
  }
  
  // 检查是否已有配置，避免重复请求
  if (REGION_CFG_MAP.has(refreshToken)) {
    return;
  }
  
  // 非CN区域：通过 user_info 接口获取域名配置
  // 并发尝试多个地区，找到第一个返回 errmsg: "success" 的
  const uri = "/lv/v1/user/web/user_info";
  const url = `https://dreamina.capcut.com${uri}`;
  const deviceTime = util.unixTimestamp();
  const signString = `9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`;
  const sign = util.md5(signString);
  
  // 提取纯 sessionid
  const { token: sessionId } = parseTokenRegion(refreshToken);
  
  // 要尝试的 cc-target-idc 列表
  const idcList = ['alisg', 'hk', 'useast5', 'sg1'];
  
  // 创建所有请求的 Promise
  const requests = idcList.map(idc => {
    const cookieStr = `sessionid=${sessionId}; sessionid_ss=${sessionId}; cc-target-idc=${idc}`;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Content-Type": "application/json",
      "appid": DEFAULT_ASSISTANT_ID,
      "sec-ch-ua-platform": '"Windows"',
      "device-time": String(deviceTime),
      "sign-ver": "1",
      "appvr": VERSION_CODE,
      "sign": sign,
      "pf": PLATFORM_CODE,
      "Cookie": cookieStr,
    } as Record<string, string | number>;

    return axios.request({
      method: "POST",
      url,
      data: {
        sem_info: {
          is_sem: false,
          medium: "Direct",
          register_source: "direct",
          register_second_source: "enter_url",
        },
      },
      headers,
      timeout: 15000,
      validateStatus: () => true,
    }).then(resp => ({
      idc,
      success: resp.status === 200 && resp.data?.errmsg === "success",
      response: resp,
    })).catch(err => ({
      idc,
      success: false,
      error: err,
    }));
  });
  
  // 并发执行所有请求
  const results = await Promise.all(requests);
  
  // 输出每个IDC的请求结果
  logger.info(`📡 IDC请求结果:`);
  results.forEach(r => {
    if (r.success) {
      logger.info(`  ✅ ${r.idc}: 成功`);
    } else {
      const errorMsg = (r as any).error?.message || (r as any).response?.data?.errmsg || '未知错误';
      logger.info(`  ❌ ${r.idc}: 失败 (${errorMsg})`);
    }
  });
  
  // 找到第一个成功的响应
  const successResult = results.find(r => r.success);
  
  // 如果所有地区都失败，抛出异常
  if (!successResult) {
    const errorMsg = `所有地区 (${idcList.join(', ')}) 请求都失败了，请检查 token 是否正确`;
    logger.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  const resp = (successResult as any).response;
  logger.info(`✅ ${sessionId} 使用地区 [${successResult.idc}] 的配置`);

    // 提取区域与域名信息
    const data = resp.data?.data;
    const rawCountry = (data?.location?.code || "").toString().toUpperCase();
    const countryCode = rawCountry || "US";
    const webIdc = data?.location?.web_idc || "useast5";
    const webDomain: string | undefined = data?.location?.domain?.web_domain;
    const commerceDomain: string | undefined = data?.location?.domain?.commerce_domain;
    const frontierDomain: string | undefined = data?.location?.domain?.frontier_domain;
    const ttsDomain: string | undefined = data?.location?.domain?.tts_domain;
    let regionKey: string | undefined;
    let mwebHost: string | undefined;
    
    if (webDomain) {
      // 形如 web-edit.us.capcut.com 或 edit-api-sg.capcut.com
      const m = webDomain.match(/(?:web-edit\.|edit-api-)([^.]+)\.capcut\.com/);
      regionKey = m?.[1];
      // 只有 US 区域用 dreamina-api，其他区域用 mweb-api
      if (regionKey === 'us') {
        mwebHost = webDomain.replace(/web-edit\.|edit-api-/, 'dreamina-api.');
      } else if (regionKey) {
        mwebHost = `https://mweb-api-${regionKey}.capcut.com`;
      }
    }

    // 兜底逻辑
    if (!mwebHost) {
      if (regionKey === 'us') {
        mwebHost = 'https://dreamina-api.us.capcut.com';
      } else if (regionKey) {
        mwebHost = `https://mweb-api-${regionKey}.capcut.com`;
      } else {
        mwebHost = 'https://mweb-api-sg.capcut.com';
      }
    }
    
    const cfg: RegionConfig = {
      countryCode,
      webIdc,
      regionKey,
      mwebHost,
      webDomain,
      commerceDomain,
      frontierDomain,
      ttsDomain,
    };
    
    REGION_CFG_MAP.set(refreshToken, cfg);
    logger.info("✅ 区域配置已从 user_info 更新:", cfg);
}

/**
 * 获取积分信息
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function getCredit(refreshToken: string) {
  const cfg = getRegionConfig(refreshToken);
  const commerceHost = cfg?.commerceDomain || "https://commerce-api-sg.capcut.com";
  const {
    credit: { gift_credit, purchase_credit, vip_credit }
  } = await request("POST", `${commerceHost}/commerce/v1/benefits/user_credit`, refreshToken, {
    data: {},
  });
  logger.info(`\n积分信息: \n赠送积分: ${gift_credit}, 购买积分: ${purchase_credit}, VIP积分: ${vip_credit}`);
  return {
    giftCredit: gift_credit,
    purchaseCredit: purchase_credit,
    vipCredit: vip_credit,
    totalCredit: gift_credit + purchase_credit + vip_credit
  }
}

/**
 * 接收今日积分
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function receiveCredit(refreshToken: string) {
  logger.info("正在收取今日积分...");
  const cfg = getRegionConfig(refreshToken);
  const commerceHost = cfg?.commerceDomain || "https://commerce-api-sg.capcut.com";
  try {
    const data = await request("POST", `${commerceHost}/commerce/v1/benefits/credit_receive`, refreshToken, {
      data: {
        time_zone: "Asia/Shanghai"
      },
    });

    const { is_first_receive, receive_quota, has_popup } = data;
    const firstReceiveText = is_first_receive ? "今日首次领取" : "今日已领取过";

    logger.info(`✅ 积分领取成功: 获得 ${receive_quota} 积分 (${firstReceiveText})`);

    return data;
  } catch (error) {
    logger.error(`❌ 积分领取失败: ${error.message || error}`);
    throw error;
  }
}

/**
 * 请求jimeng
 *
 * @param method 请求方法
 * @param uri 请求路径
 * @param params 请求参数
 * @param headers 请求头
 */
export async function request(
  method: string,
  uri: string,
  refreshToken: string,
  options: AxiosRequestConfig = {}
) {
  const token = await acquireToken(refreshToken);
  // 依据 ensureMsToken 的域名配置动态拼接 /mweb/* 的 Host
  let url = uri;
  if (!uri.startsWith("https://")) {
    if (uri.startsWith("/mweb/")) {
      const cfg = getRegionConfig(refreshToken);
      const host = cfg?.mwebHost || "https://mweb-api-sg.capcut.com";
      url = `${host}${uri}`;
    } else {
      url = `https://mweb-api-sg.capcut.com${uri}`;
    }
  }
  const deviceTime = util.unixTimestamp();
  // 使用真实请求路径计算签名（兼容绝对URL与相对路径）
  const pathForSign = (() => {
    try {
      const u = new URL(url);
      return u.pathname || "/";
    } catch {
      try {
        const u2 = new URL(`${url.startsWith("http") ? url : `https://dummy${url.startsWith('/') ? '' : '/'}${url}`}`);
        return u2.pathname || "/";
      } catch {
        return "/";
      }
    }
  })();
  const sign = util.md5(
    `9e2c|${pathForSign.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`
  );
  const isJimengHost = url.includes("jimeng.jianying.com");
  const regionParam = (options.params as any)?.region as string | undefined;
  const paramsObj = {
    aid: isJimengHost ? CN_ASSISTANT_ID : DEFAULT_ASSISTANT_ID,
    device_platform: "web",
    ...(isJimengHost ? { webId: WEB_ID } : { web_id: WEB_ID }),
    ...(options.params || {}),
  } as Record<string, any>;
  
  const response = await axios.request({
    method,
    url,
    params: paramsObj,
    headers: {
      ...FAKE_HEADERS,
      Did: String(DEVICE_ID),
      Cookie: generateCookie(token, regionParam || getRegionConfig(refreshToken)?.countryCode),
      "Device-Time": deviceTime,
      // US 域名也接受 Sign，这里统一附带
      Sign: sign,
      "Sign-Ver": "1",
      // 针对 CN: 使用 jimeng.jianying.com 的站点头
      ...(isJimengHost
        ? {
            Origin: "https://jimeng.jianying.com",
            Referer: "https://jimeng.jianying.com",
            "Sec-Fetch-Site": "same-origin",
            lan: "zh-Hans",
            loc: "cn",
            Appid: CN_ASSISTANT_ID,
          }
        : {
            Origin: "https://dreamina.capcut.com",
            Referer: "https://dreamina.capcut.com/",
            "Sec-Fetch-Site": "same-site",
          }),
      ...(options.headers || {}),
    },
    timeout: 15000,
    validateStatus: () => true,
    ..._.omit(options, "params", "headers"),
  });
  // logger.info("request response:", response)
  // 流式响应直接返回response
  if (options.responseType == "stream") return response;
  return checkResult(response);
}

/**
 * 预检查文件URL有效性
 *
 * @param fileUrl 文件URL
 */
export async function checkFileUrl(fileUrl: string) {
  if (util.isBASE64Data(fileUrl)) return;
  const result = await axios.head(fileUrl, {
    timeout: 15000,
    validateStatus: () => true,
  });
  if (result.status >= 400)
    throw new APIException(
      EX.API_FILE_URL_INVALID,
      `File ${fileUrl} is not valid: [${result.status}] ${result.statusText}`
    );
  // 检查文件大小
  if (result.headers && result.headers["content-length"]) {
    const fileSize = parseInt(result.headers["content-length"], 10);
    if (fileSize > FILE_MAX_SIZE)
      throw new APIException(
        EX.API_FILE_EXECEEDS_SIZE,
        `File ${fileUrl} is not valid`
      );
  }
}

/**
 * 上传文件
 *
 * @param fileUrl 文件URL
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param isVideoImage 是否是用于视频图像
 */
export async function uploadFile(
  fileUrl: string,
  refreshToken: string,
  isVideoImage: boolean = false,
  country?: string
) {
  // 预检查远程文件URL可用性
  await checkFileUrl(fileUrl);

  let filename, fileData, mimeType;
  // 如果是BASE64数据则直接转换为Buffer
  if (util.isBASE64Data(fileUrl)) {
    mimeType = util.extractBASE64DataFormat(fileUrl);
    const ext = mime.getExtension(mimeType);
    filename = `${util.uuid()}.${ext}`;
    fileData = Buffer.from(util.removeBASE64DataHeader(fileUrl), "base64");
  }
  // 下载文件到内存，如果您的服务器内存很小，建议考虑改造为流直传到下一个接口上，避免停留占用内存
  else {
    filename = path.basename(fileUrl);
    ({ data: fileData } = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      // 100M限制
      maxContentLength: FILE_MAX_SIZE,
      // 60秒超时
      timeout: 60000,
    }));
  }

  // 获取文件的MIME类型（宽高由服务端在 CN Commit 返回，不再本地解析）
  mimeType = mimeType || mime.getType(filename);

  // 1) 获取上传临时凭证
  const uploadToken = await getUploadToken(refreshToken, country);
  const {
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    session_token: sessionToken,
    space_name: serviceId,
    upload_domain: uploadDomain,
    region: regionShort,
  } = uploadToken;

  // 2) 申请上传（ApplyImageUpload）
  const fileSize = Buffer.byteLength(fileData);
  const { UploadAddress } = await applyImageUpload({
    uploadDomain,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    serviceId,
    fileSize,
    regionShort,
  });
  if (!UploadAddress || !UploadAddress.StoreInfos?.length)
    throw new APIException(EX.API_REQUEST_FAILED, "获取上传地址失败");
  const storeInfo = UploadAddress.StoreInfos[0];
  const uploadHost = (UploadAddress.UploadHosts && UploadAddress.UploadHosts[0]) || UploadAddress.UploadHost;
  if (!uploadHost) throw new APIException(EX.API_REQUEST_FAILED, "缺少上传主机");

  // 3) 上传二进制到 TOS
  await uploadToTOS({
    host: uploadHost,
    storeUri: storeInfo.StoreUri,
    auth: storeInfo.Auth,
    filename,
    data: fileData,
    originHost: regionShort === 'cn' ? 'jimeng' : 'dreamina',
  });

  // 4) CommitImageUpload（所有区域均调用，用于拿到图片宽高等信息）
  let commitMeta: { width?: number; height?: number } = {};
  try {
    const endpoint = uploadDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const sessionKey = UploadAddress.SessionKey || '';
    // 解析签名区域，复用 ApplyImageUpload 的逻辑
    const regionAws = (() => {
      if (regionShort === 'cn') return 'cn-north-1';
      if (regionShort === 'sg') return 'ap-singapore-1';
      const m = uploadDomain.match(/imagex-([^.]+)\./);
      if (m?.[1]) return m[1];
      if (/bytedanceapi\.com$/.test(uploadDomain)) return 'cn-north-1';
      return 'ap-singapore-1';
    })();
    commitMeta = await commitImageUpload({
      endpoint,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      serviceId,
      sessionKey,
      regionAws,
      originHost: regionShort === 'cn' ? 'jimeng' : 'dreamina',
    });
  } catch (e) {
    // Commit 失败不阻断主流程，但无法获得宽高
    logger.warn('CommitImageUpload 失败（忽略）:', e?.message || e);
  }

  return {
    storeUri: storeInfo.StoreUri,
    uploadHost,
    serviceId,
    size: fileSize,
    mimeType,
    width: commitMeta.width,
    height: commitMeta.height,
  };
}

/** 获取 ImageX 上传临时凭证 */
export async function getUploadToken(refreshToken: string, country?: string) {
  await ensureMsToken(refreshToken);
  const cfg = getRegionConfig(refreshToken);
  const params: any = {
    web_version: "6.6.0",
    da_version: "3.2.8",
    aigc_features: "app_lip_sync",
    ...(country ? { region: country } : {}),
    msToken: await ensureMsToken(refreshToken)
  };
  // 网络偶发 TLS 握手失败，做少量重试
  let lastErr: any;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await request(
        "POST",
        `/mweb/v1/get_upload_token`,
        refreshToken,
        {
          params,
          data: { scene: 2 },
        }
      );
      return result;
    } catch (err: any) {
      lastErr = err;
      const msg = `${err?.code || ''} ${err?.message || err}`;
      if (/TLS|ECONNRESET|ECONNABORTED|ETIMEDOUT/i.test(msg) && i < 2) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/** 申请上传地址（ApplyImageUpload） */
async function applyImageUpload({
  uploadDomain,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  serviceId,
  fileSize,
  regionShort,
}: {
  uploadDomain: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  serviceId: string; // space_name
  fileSize: number;
  regionShort?: string; // e.g., 'cn', 'sg'
}) {
  // 解析签名区域
  let region = (() => {
    if (regionShort === 'cn') return 'cn-north-1';
    if (regionShort === 'sg') return 'ap-singapore-1';
    const m = uploadDomain.match(/imagex-([^.]+)\./);
    if (m?.[1]) return m[1];
    if (/bytedanceapi\.com$/.test(uploadDomain)) return 'cn-north-1';
    return 'ap-singapore-1';
  })();
  const query: Record<string, string | number> = {
    Action: "ApplyImageUpload",
    Version: "2018-08-01",
    ServiceId: serviceId,
    FileSize: fileSize,
    device_platform: "web",
  };
  const url = `https://${uploadDomain}/`;
  const { headers: sigHeaders } = signAwsV4({
    method: "GET",
    service: "imagex",
    region,
    host: uploadDomain,
    path: "/",
    query,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });
  const resp = await axios.request({
    method: "GET",
    url,
    params: query,
    headers: sigHeaders,
    timeout: 15000,
    validateStatus: () => true,
  });
  if (resp.status >= 400)
    throw new APIException(EX.API_REQUEST_FAILED, `ApplyImageUpload失败: [${resp.status}] ${resp.statusText}`);
  if (resp.data?.ResponseMetadata?.Action !== "ApplyImageUpload")
    throw new APIException(EX.API_REQUEST_FAILED, "ApplyImageUpload返回异常");
  return resp.data.Result || {};
}

/** 上传到 TOS */
async function uploadToTOS({
  host,
  storeUri,
  auth,
  filename,
  data,
  originHost,
}: {
  host: string;
  storeUri: string;
  auth: string;
  filename: string;
  data: Buffer;
  originHost?: 'jimeng' | 'dreamina';
}) {
  const crc = CRC32.buf(Uint8Array.from(data)) >>> 0; // unsigned
  const crcHex = crc.toString(16).padStart(8, "0");
  const url = `https://${host}/upload/v1/${storeUri}`;
  const resp = await axios.request({
    method: "POST",
    url,
    data,
    headers: {
      Authorization: auth,
      "Content-CRC32": crcHex,
      "Content-Disposition": `attachment; filename="${filename || "file"}"`,
      "Content-Type": "application/octet-stream",
      Origin: originHost === 'jimeng' ? 'https://jimeng.jianying.com' : 'https://dreamina.capcut.com',
      Referer: originHost === 'jimeng' ? 'https://jimeng.jianying.com/' : 'https://dreamina.capcut.com/',
    },
    timeout: 60000,
    maxContentLength: FILE_MAX_SIZE,
    validateStatus: () => true,
  });
  if (resp.status >= 400 || resp.data?.code !== 2000)
    throw new APIException(EX.API_REQUEST_FAILED, `上传失败: [${resp.status}] ${resp.statusText}`);
  return true;
}

/** 简化版 AWS SigV4（用于 ImageX） */
function signAwsV4({
  method,
  service,
  region,
  host,
  path,
  query,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payloadSha256,
  includeContentSha256,
}: {
  method: string;
  service: string;
  region: string;
  host: string;
  path: string;
  query: Record<string, string | number>;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  payloadSha256?: string; // hex string
  includeContentSha256?: boolean;
}) {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = amzDate.slice(0, 8);

  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
    .join("&");

  const contentSha = includeContentSha256 ? (payloadSha256 || crypto.createHash('sha256').update('').digest('hex')) : undefined;
  const canonicalHeaders =
    (includeContentSha256 ? `x-amz-content-sha256:${contentSha}\n` : '') +
    `x-amz-date:${amzDate}\n` +
    `x-amz-security-token:${sessionToken}\n`;
  const signedHeaders = (includeContentSha256 ? 'x-amz-content-sha256;' : '') + 'x-amz-date;x-amz-security-token';
  const payloadHash = includeContentSha256 ? contentSha! : crypto.createHash("sha256").update("").digest("hex");
  const canonicalRequest = [method.toUpperCase(), path, qs, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const canonicalRequestHash = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${canonicalRequestHash}`;

  // Ensure ArrayBufferView compatible keys for createSecretKey
  const toArrayView = (src: Buffer | string) =>
    typeof src === 'string' ? Uint8Array.from(Buffer.from(src)) : Uint8Array.from(src);

  const kDate = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView("AWS4" + secretAccessKey)))
    .update(date)
    .digest();
  const kRegion = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kDate)))
    .update(region)
    .digest();
  const kService = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kRegion)))
    .update(service)
    .digest();
  const kSigning = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kService)))
    .update("aws4_request")
    .digest();
  const signature = crypto
    .createHmac("sha256", crypto.createSecretKey(toArrayView(kSigning)))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      Host: host,
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-security-token": sessionToken,
      ...(includeContentSha256 ? { 'x-amz-content-sha256': payloadHash } : {}),
    },
  };
}

/** Commit 上传（CN 需要） */
async function commitImageUpload({
  endpoint,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  serviceId,
  sessionKey,
  regionAws,
  originHost,
}: {
  endpoint: string; // imagex host
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  serviceId: string;
  sessionKey: string;
  regionAws: string;
  originHost?: 'jimeng' | 'dreamina';
}): Promise<{ width?: number; height?: number }> {
  const url = `https://${endpoint}/`;
  const query = {
    Action: 'CommitImageUpload',
    Version: '2018-08-01',
    ServiceId: serviceId,
  } as Record<string, string>;
  const body = JSON.stringify({ SessionKey: sessionKey });
  const bodySha = crypto.createHash('sha256').update(body).digest('hex');
  const { headers: sigHeaders } = signAwsV4({
    method: 'POST',
    service: 'imagex',
    region: regionAws,
    host: endpoint,
    path: '/',
    query,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    payloadSha256: bodySha,
    includeContentSha256: true,
  });
  const resp = await axios.request({
    method: 'POST',
    url,
    params: query,
    data: body,
    headers: {
      ...sigHeaders,
      'Content-Type': 'application/json',
      Origin: originHost === 'jimeng' ? 'https://jimeng.jianying.com' : 'https://dreamina.capcut.com',
      Referer: originHost === 'jimeng' ? 'https://jimeng.jianying.com/' : 'https://dreamina.capcut.com/',
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (resp.status >= 400 || resp.data?.ResponseMetadata?.Action !== 'CommitImageUpload')
    throw new APIException(EX.API_REQUEST_FAILED, `CommitImageUpload失败: [${resp.status}] ${resp.statusText}`);
  const plugin = resp.data?.Result?.PluginResult?.[0];
  return {
    width: plugin?.ImageWidth,
    height: plugin?.ImageHeight,
  };
}

/**
 * 解析 refreshToken 可选区域后缀（例如 "<token>:cn"）
 */
export function parseTokenRegion(refreshToken: string): { token: string; region?: string } {
  const m = refreshToken?.match(/^(.*?):([a-zA-Z]+)$/);
  if (m) return { token: m[1], region: m[2] };
  return { token: refreshToken };
}



/**
 * 检查请求结果
 *
 * @param result 结果
 */
export function checkResult(result: AxiosResponse) {
  const { ret, errmsg, data } = result.data;
  if (!_.isFinite(Number(ret))) return result.data;
  if (ret === '0') return data;
  if (ret === '5000')
    throw new APIException(EX.API_IMAGE_GENERATION_INSUFFICIENT_POINTS, `[无法生成图像]: 即梦积分可能不足，${errmsg}`);
  throw new APIException(EX.API_REQUEST_FAILED, `[请求jimeng失败]: ${errmsg}`);
}

/**
 * Token切分
 *
 * @param authorization 认证字符串
 */
export function tokenSplit(authorization: string) {

  return authorization.replace("Bearer ", "").split(",");
}

/**
 * 获取Token存活状态
 */
export async function getTokenLiveStatus(refreshToken: string) {
  const result = await request(
    "POST",
    "/passport/account/info/v2",
    refreshToken,
    {
      params: {
        account_sdk_source: "web",
      },
    }
  );
  try {
    logger.info("getTokenLiveStatus:", result)
    const { user_id } = checkResult(result);
    return !!user_id;
  } catch (err) {
    return false;
  }
}
