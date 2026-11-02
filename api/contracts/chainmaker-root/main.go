package main

import (
	"encoding/json"
	"log"
	"wanderlust/chainmaker-root/core"

	"chainmaker.org/chainmaker/contract-sdk-go/v2/pb/protogo"
	"chainmaker.org/chainmaker/contract-sdk-go/v2/sandbox"
	"chainmaker.org/chainmaker/contract-sdk-go/v2/sdk"
)

type chainStore struct{}

func (chainStore) Get(k string) (string, bool, error) {
	return sdk.Instance.GetStateFromKeyWithExists(k)
}
func (chainStore) Put(k, v string) error { return sdk.Instance.PutStateFromKey(k, v) }

type RootContract struct{}

func (*RootContract) InitContract() protogo.Response {
	owner, err := sdk.Instance.GetSenderAddr()
	if err == nil {
		err = core.Init(chainStore{}, owner)
	}
	if err != nil {
		return sdk.Error(err.Error())
	}
	return sdk.Success([]byte("initialized"))
}
func (*RootContract) UpgradeContract() protogo.Response {
	return sdk.Error("root contract upgrades are disabled")
}
func (*RootContract) InvokeContract(method string) protogo.Response {
	args := sdk.Instance.GetArgs()
	switch method {
	case "writeRoot":
		sender, err := sdk.Instance.GetSenderAddr()
		if err != nil {
			return sdk.Error(err.Error())
		}
		txID, err := sdk.Instance.GetTxId()
		if err != nil {
			return sdk.Error(err.Error())
		}
		record := core.Record{Root: string(args["root"]), PrevRoot: string(args["prevRoot"]), BizDate: string(args["bizDate"]), TxID: txID}
		if err = core.Write(chainStore{}, sender, record); err != nil {
			return sdk.Error(err.Error())
		}
		return sdk.Success([]byte("ok"))
	case "readRoot":
		record, err := core.Read(chainStore{}, string(args["root"]))
		if err != nil {
			return sdk.Error(err.Error())
		}
		value, err := json.Marshal(record)
		if err != nil {
			return sdk.Error(err.Error())
		}
		return sdk.Success(value)
	default:
		return sdk.Error("unknown method")
	}
}
func main() {
	if err := sandbox.Start(new(RootContract)); err != nil {
		log.Fatal(err)
	}
}
