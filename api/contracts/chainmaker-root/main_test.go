package main

import (
	"chainmaker.org/chainmaker/contract-sdk-go/v2/sdk"
	"encoding/json"
	"strings"
	"testing"
)

type fakeSDK struct {
	sdk.SDKInterface
	data       map[string]string
	args       map[string][]byte
	sender, tx string
}

func (f *fakeSDK) GetArgs() map[string][]byte     { return f.args }
func (f *fakeSDK) GetSenderAddr() (string, error) { return f.sender, nil }
func (f *fakeSDK) GetTxId() (string, error)       { return f.tx, nil }
func (f *fakeSDK) GetStateFromKeyWithExists(k string) (string, bool, error) {
	v, ok := f.data[k]
	return v, ok, nil
}
func (f *fakeSDK) PutStateFromKey(k, v string) error { f.data[k] = v; return nil }
func TestContractRuntime(t *testing.T) {
	old := sdk.Instance
	defer func() { sdk.Instance = old }()
	f := &fakeSDK{data: map[string]string{}, sender: "owner", tx: strings.Repeat("b", 64)}
	sdk.Instance = f
	c := new(RootContract)
	if c.InitContract().Status != 0 {
		t.Fatal("initialization failed")
	}
	root := strings.Repeat("a", 64)
	f.args = map[string][]byte{"root": []byte(root), "prevRoot": []byte(strings.Repeat("0", 64)), "bizDate": []byte("20261102")}
	f.sender = "other"
	if c.InvokeContract("writeRoot").Status == 0 {
		t.Fatal("unauthorized write")
	}
	f.sender = "owner"
	if c.InvokeContract("writeRoot").Status != 0 {
		t.Fatal("write failed")
	}
	if c.InvokeContract("writeRoot").Status == 0 {
		t.Fatal("duplicate allowed")
	}
	resp := c.InvokeContract("readRoot")
	var result map[string]string
	if resp.Status != 0 || json.Unmarshal(resp.Payload, &result) != nil || result["txId"] != f.tx || result["root"] != root {
		t.Fatal("bad readback")
	}
	if c.UpgradeContract().Status == 0 {
		t.Fatal("upgrade allowed")
	}
}
