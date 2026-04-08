/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 微软账号密码登录预热补丁：
 * 仅替换 @xboxreplay/xboxlive-auth 的 preAuth/logUser 页面解析逻辑，
 * 后续 Xbox/XSTS/Minecraft token 仍使用原库流程。
 */

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&#x2f;/g, '/').replace(/&quot;/g, '"');
}

function parseHashFragment(target: string): Record<string, any> {
  const hash = target.includes('#') ? target.split('#')[1] : target;
  const params = new URLSearchParams(hash);
  const ret: Record<string, any> = {};
  for (const [k, v] of params.entries()) ret[k] = v;
  if (ret.expires_in) ret.expires_in = Number(ret.expires_in);
  return ret;
}

async function robustPreAuth(baseHeaders: Record<string, string>, authorizeUrl: string): Promise<any> {
  const resp = await fetch(authorizeUrl, { headers: baseHeaders, redirect: 'follow' });
  const body = await resp.text();

  if (!resp.ok) {
    throw new Error(`Pre-authentication failed (${resp.status})`);
  }

  const setCookie = (resp.headers as any).getSetCookie?.() as string[] | undefined;
  const cookie = (setCookie || [])
    .map(c => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

  const PPFT = firstMatch(body, [
    /sFTTag:'.*value=\"([^\"]+)\"\/>'/s,
    /name="PPFT"[^>]*value="([^"]+)"/i,
    /value="([^"]+)"[^>]*name="PPFT"/i,
  ]);

  const rawUrlPost = firstMatch(body, [
    /urlPost:'([^']+)'/i,
    /urlPost\s*:\s*'([^']+)'/i,
    /urlPost\s*=\s*'([^']+)'/i,
  ]);

  if (!PPFT || !rawUrlPost) {
    throw new Error('Could not match login page parameters (PPFT/urlPost)');
  }

  return {
    cookie,
    matches: {
      PPFT,
      urlPost: decodeHtml(rawUrlPost),
    },
  };
}

async function hardcodedLogUser(credentials: { email: string; password: string }, baseHeaders: Record<string, string>): Promise<any> {
  // 按“硬写页面参数”方式走一遍（固定 PPFT + 固定 post.srf 参数）
  // 这是兼容层：优先尝试硬写，失败再回退到通用解析。
  const fixedPostUrl =
    'https://login.live.com/ppsecure/post.srf?id=74335&contextid=234014DB41B61525&opid=1956E33996A4C9C4&bk=1714743335&uaid=fc6b7450f145408fb5ec025d4dd0cecd&pid=0';

  const form = new URLSearchParams({
    ps: '2',
    psRNGCDefaultType: '',
    psRNGCEntropy: '',
    psRNGCSLK: '',
    canary: '',
    ctx: '',
    hpgrequestid: '',
    PPFT:
      '-DqrJf42zHrBGKJDrPFYIVqLmGmWJW7fcEZw*qF2uHRLgKfvHI4kF942GFl6AYz2MHhcwhEzUBsvd2SoHnRvfJFO0daLHDg5VKkr6sj*zFQX24i1Kq2CB2ikUrZvWVrA862xff8C1Zj7BN59FIyODz5GEIVk1gtmgAxeKF17q!bFnBhwufbUqGhdFbPLLW8A8bMRrFweSUeViPum2S6DZhVo$',
    PPSX: 'PassportRN',
    NewUser: '1',
    FoundMSAs: '',
    fspost: '0',
    i21: '0',
    CookieDisclosure: '0',
    IsFidoSupported: '1',
    isSignupPost: '0',
    isRecoveryAttemptPost: '0',
    i13: '0',
    login: credentials.email,
    loginfmt: credentials.email,
    type: '11',
    LoginOptions: '3',
    lrt: '',
    lrtPartition: '',
    hisRegion: '',
    hisScaleUnit: '',
    passwd: credentials.password,
  });

  const resp = await fetch(fixedPostUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const location = resp.headers.get('location') || '';
  if (location.includes('#access_token=')) return parseHashFragment(location);

  const body = await resp.text();
  const inlineRedirect = firstMatch(body, [
    /window\.location\.href\s*=\s*"([^"]+)"/i,
    /window\.location\.replace\("([^"]+)"\)/i,
    /document\.location\s*=\s*'([^']+)'/i,
  ]);

  if (inlineRedirect && inlineRedirect.includes('#access_token=')) {
    return parseHashFragment(decodeHtml(inlineRedirect));
  }

  throw new Error('Hardcoded login flow did not return access token');
}

async function robustLogUser(preAuthResponse: any, credentials: { email: string; password: string }, baseHeaders: Record<string, string>): Promise<any> {
  const form = new URLSearchParams({
    login: credentials.email,
    loginfmt: credentials.email,
    passwd: credentials.password,
    PPFT: preAuthResponse.matches.PPFT,
  });

  const resp = await fetch(preAuthResponse.matches.urlPost, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: preAuthResponse.cookie || '',
    },
    body: form.toString(),
  });

  const location = resp.headers.get('location') || '';

  // 常见成功路径：302 -> location 含 #access_token=...
  if (location.includes('#access_token=')) {
    return parseHashFragment(location);
  }

  // 某些场景会直接 200 返回中间页面，再从 body 中提取跳转 URL
  const body = await resp.text();
  const inlineRedirect = firstMatch(body, [
    /window\.location\.href\s*=\s*"([^"]+)"/i,
    /window\.location\.replace\("([^"]+)"\)/i,
    /document\.location\s*=\s*'([^']+)'/i,
  ]);

  if (inlineRedirect && inlineRedirect.includes('#access_token=')) {
    return parseHashFragment(decodeHtml(inlineRedirect));
  }

  if (resp.status === 200) {
    throw new Error('Invalid credentials or extra verification required');
  }

  throw new Error(`Authentication failed (${resp.status})`);
}

export function applyXboxLiveLoginPagePatch(): void {
  // 仅在运行时打补丁，避免修改第三方源码
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XboxLiveAuth = require('@xboxreplay/xboxlive-auth');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const liveConfig = require('@xboxreplay/xboxlive-auth/dist/core/live/config').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rootConfig = require('@xboxreplay/xboxlive-auth/dist/config').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const liveModule = require('@xboxreplay/xboxlive-auth/dist/core/live');

  const authorizeUrl = `${liveConfig.uris.authorize}?${new URLSearchParams(liveConfig.queries.authorize as Record<string, string>).toString()}`;
  const baseHeaders = rootConfig.request.baseHeaders as Record<string, string>;

  const preAuthPatched = () => robustPreAuth(baseHeaders, authorizeUrl);
  const logUserPatched = async (preAuthResponse: any, credentials: { email: string; password: string }) => {
    try {
      return await hardcodedLogUser(credentials, baseHeaders);
    } catch {
      return robustLogUser(preAuthResponse, credentials, baseHeaders);
    }
  };

  XboxLiveAuth.preAuth = preAuthPatched;
  XboxLiveAuth.logUser = logUserPatched;
  liveModule.preAuth = preAuthPatched;
  liveModule.logUser = logUserPatched;
}
