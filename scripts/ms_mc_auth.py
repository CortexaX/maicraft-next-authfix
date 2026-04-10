import re
import requests
import warnings
import json
warnings.filterwarnings("ignore")
from urllib.parse import urlparse, parse_qs
import threading
import sys

# ==========================================
# 全局初始化
# ==========================================
file_lock = threading.Lock()
global_session = None

SFTTAG_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=00000000402B5328"
    "&redirect_uri=https://login.live.com/oauth20_desktop.srf"
    "&scope=service::user.auth.xboxlive.com::MBI_SSL"
    "&display=touch"
    "&response_type=token"
    "&locale=en"
)


def extract_server_data(html):
    """从HTML中提取ServerData JSON"""
    match = re.search(r'var ServerData = ({.*?});', html, re.DOTALL)
    if not match:
        return None

    try:
        server_data_str = match.group(1)
        server_data = json.loads(server_data_str)
        return server_data
    except:
        return None


def login(phone_number, pwd):
    """第一步：从SFTTAG_URL登录并直接获取RPS token"""
    global global_session

    global_session = requests.session()
    global_session.verify = False

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }

    try:
        r = global_session.get(SFTTAG_URL, headers=headers, timeout=15, verify=False)
        html = r.text

        server_data = extract_server_data(html)

        if not server_data:
            return None

        sft_tag = server_data.get('sFTTag', '')
        ppft_match = re.search(r'value="([^"]+)"', sft_tag)

        if not ppft_match:
            return None

        ppft = ppft_match.group(1)

        urlpost = server_data.get('urlPost') or server_data.get('urlPostMsa')
        if not urlpost:
            return None

        login_data = {
            'login': phone_number,
            'loginfmt': phone_number,
            'passwd': pwd,
            'PPFT': ppft,
            'ps': '2',
            'type': '11',
            'LoginOptions': '3',
        }

        login_headers = headers.copy()
        login_headers['Content-Type'] = 'application/x-www-form-urlencoded'
        login_headers['Origin'] = 'https://login.live.com'
        login_headers['Referer'] = SFTTAG_URL

        response = global_session.post(
            urlpost,
            data=login_data,
            headers=login_headers,
            verify=False,
            timeout=15,
            allow_redirects=True
        )

        if "#access_token" not in response.url:
            return None

        token = parse_qs(urlparse(response.url).fragment).get("access_token", [None])[0]
        if not token:
            return None

        return token

    except Exception:
        return None


def get_xbox_xsts(ms_token):
    """第二步：获取Xbox和XSTS token"""
    global global_session

    try:
        r = global_session.post(
            "https://user.auth.xboxlive.com/user/authenticate",
            json={
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": ms_token
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT"
            },
            timeout=15,
            verify=False
        )

        if r.status_code != 200:
            return None

        data = r.json()
        xbox_token = data.get("Token")
        if not xbox_token:
            return None

        try:
            uhs = data["DisplayClaims"]["xui"][0]["uhs"]
        except Exception:
            return None

        r = global_session.post(
            "https://xsts.auth.xboxlive.com/xsts/authorize",
            json={
                "Properties": {
                    "SandboxId": "RETAIL",
                    "UserTokens": [xbox_token]
                },
                "RelyingParty": "rp://api.minecraftservices.com/",
                "TokenType": "JWT"
            },
            timeout=15,
            verify=False
        )

        if r.status_code != 200:
            return None

        data = r.json()
        xsts = data.get("Token")
        if not xsts:
            return None

        return uhs, xsts

    except Exception:
        return None


def get_mc_token(uhs, xsts):
    """第三步：获取Minecraft token"""
    global global_session
    try:
        r = global_session.post(
            "https://api.minecraftservices.com/authentication/login_with_xbox",
            json={"identityToken": f"XBL3.0 x={uhs};{xsts}"},
            timeout=15,
            verify=False
        )

        if r.status_code != 200:
            return None

        data = r.json()
        token = data.get("access_token")
        if not token:
            return None

        return token

    except Exception:
        return None


def get_mc_profile(access_token):
    """第四步：获取Minecraft账户信息"""
    global global_session
    try:
        r = global_session.get(
            "https://api.minecraftservices.com/minecraft/profile",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
            verify=False
        )

        if r.status_code != 200:
            return None

        profile = r.json()

        return {
            'id': profile.get('id'),
            'name': profile.get('name')
        }

    except Exception:
        return None


def authenticate(phone_number, password):
    """完整认证流程"""

    ms_token = login(phone_number, password)
    if not ms_token:
        return None

    result = get_xbox_xsts(ms_token)
    if not result:
        return None

    uhs, xsts = result

    mc_token = get_mc_token(uhs, xsts)
    if not mc_token:
        return None

    profile = get_mc_profile(mc_token)
    if not profile:
        return None

    return {
        "token": mc_token,
        "profile": profile,
        "entitlements": {},
        "certificates": {}
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python ms_mc_auth.py <username> <password>"}))
        sys.exit(1)

    phone_number = sys.argv[1]
    password = sys.argv[2]

    result = authenticate(phone_number, password)

    if result:
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Authentication failed"}))
        sys.exit(2)
