"""TBaaS 长安链体验网络接入演示：写入 -> 读回 -> 按交易ID核对。

依赖：pip install tencentcloud-sdk-python
凭据：环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY（不要写进代码）
注意：体验网络是共享测试网，请勿写入真实业务数据；接口限频 1 次/秒。
"""
import base64
import json
import os
import time

from tencentcloud.common import credential
from tencentcloud.common.common_client import CommonClient
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile

CLUSTER_ID = "chainmaker-demo"
CHAIN_ID = "chain_demo"
CONTRACT = "ChainMakerDemo"
REGION = "ap-beijing"  # 体验网络接口仅支持北京


def make_client():
    cred = credential.Credential(
        os.environ["TENCENTCLOUD_SECRET_ID"], os.environ["TENCENTCLOUD_SECRET_KEY"]
    )
    http = HttpProfile(endpoint="tbaas.tencentcloudapi.com")
    return CommonClient("tbaas", "2018-04-16", cred, REGION, ClientProfile(httpProfile=http))


def call(client, action, params):
    resp = client.call_json(action, params)["Response"]
    time.sleep(1.1)  # 限频 1 次/秒
    if "Error" in resp:
        raise RuntimeError(f"{action} 失败: {resp['Error']}")
    return resp["Result"]


def invoke(client, func, func_param, async_flag=0):
    """上链（写）。async_flag=1 时需用返回的 TxId 再查结果。"""
    return call(client, "InvokeChainMakerDemoContract", {
        "ClusterId": CLUSTER_ID, "ChainId": CHAIN_ID, "ContractName": CONTRACT,
        "FuncName": func, "FuncParam": json.dumps(func_param), "AsyncFlag": async_flag,
    })


def query(client, func, func_param):
    """合约查询（读）。Result 为 base64，需要解码。"""
    r = call(client, "QueryChainMakerDemoContract", {
        "ClusterId": CLUSTER_ID, "ChainId": CHAIN_ID, "ContractName": CONTRACT,
        "FuncName": func, "FuncParam": json.dumps(func_param),
    })
    return base64.b64decode(r.get("Result") or "").decode("utf-8", "replace")


def get_tx(client, tx_id):
    return call(client, "QueryChainMakerDemoTransaction", {
        "ClusterId": CLUSTER_ID, "ChainId": CHAIN_ID, "TxID": tx_id,
    })


if __name__ == "__main__":
    c = make_client()
    key, field, value = f"wenlv-test-{int(time.time())}", "ticket_status", "test-issued"

    tx = invoke(c, "save", {"key": key, "field": field, "value": value})
    print("1. 写入 TxId:", tx["TxId"], "Code:", tx["Code"])

    got = query(c, "get", {"key": key, "field": field})
    print("2. 读回:", got, "| 一致:", got == value)

    print("3. 按交易ID核对:", json.dumps(get_tx(c, tx["TxId"]), ensure_ascii=False)[:500])

    # 额外验证：重复写同一个 key 是否覆盖（门票“只能核销一次”依赖合约自身，不在此演示合约内保证）
    invoke(c, "save", {"key": key, "field": field, "value": "overwritten"})
    print("4. 重复写入后读回:", query(c, "get", {"key": key, "field": field}))
