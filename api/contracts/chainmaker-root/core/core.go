// Package core implements immutable root records independent of the chain runtime.
package core

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Store interface {
	Get(string) (string, bool, error)
	Put(string, string) error
}
type Record struct {
	Root     string `json:"root"`
	PrevRoot string `json:"prevRoot"`
	BizDate  string `json:"bizDate"`
	TxID     string `json:"txId"`
}

const ownerKey = "owner"

func validHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil && s == fmt.Sprintf("%x", mustDecode(s))
}
func mustDecode(s string) []byte { b, _ := hex.DecodeString(s); return b }
func Init(s Store, owner string) error {
	if owner == "" {
		return errors.New("empty owner")
	}
	_, exists, err := s.Get(ownerKey)
	if err != nil {
		return err
	}
	if exists {
		return errors.New("already initialized")
	}
	return s.Put(ownerKey, owner)
}
func Write(s Store, sender string, r Record) error {
	owner, exists, err := s.Get(ownerKey)
	if err != nil {
		return err
	}
	if !exists || sender == "" || sender != owner {
		return errors.New("unauthorized")
	}
	if !validHash(r.Root) || !validHash(r.PrevRoot) || !validHash(r.TxID) {
		return errors.New("invalid hash or transaction id")
	}
	if _, err = time.Parse("20060102", r.BizDate); err != nil {
		return errors.New("invalid date")
	}
	_, exists, err = s.Get(r.Root)
	if err != nil {
		return err
	}
	if exists {
		return errors.New("root already recorded")
	}
	value, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return s.Put(r.Root, string(value))
}
func Read(s Store, root string) (Record, error) {
	var r Record
	if !validHash(root) {
		return r, errors.New("invalid root")
	}
	value, exists, err := s.Get(root)
	if err != nil {
		return r, err
	}
	if !exists {
		return r, errors.New("root not found")
	}
	err = json.Unmarshal([]byte(value), &r)
	if err != nil || r.Root != root {
		return Record{}, errors.New("invalid stored record")
	}
	return r, nil
}
