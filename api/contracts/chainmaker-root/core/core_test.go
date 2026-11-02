package core

import (
	"errors"
	"strings"
	"testing"
)

type memory map[string]string

func (m memory) Get(k string) (string, bool, error) { v, ok := m[k]; return v, ok, nil }
func (m memory) Put(k, v string) error              { m[k] = v; return nil }

type broken struct{ memory }

func (b broken) Get(string) (string, bool, error) { return "", false, errors.New("storage failure") }
func TestImmutableAuthorizedRecord(t *testing.T) {
	s := memory{}
	if err := Init(s, "writer"); err != nil {
		t.Fatal(err)
	}
	r := Record{Root: strings.Repeat("a", 64), PrevRoot: strings.Repeat("0", 64), BizDate: "20261102", TxID: strings.Repeat("b", 64)}
	if err := Write(s, "intruder", r); err == nil {
		t.Fatal("unauthorized write accepted")
	}
	if err := Write(s, "writer", r); err != nil {
		t.Fatal(err)
	}
	got, err := Read(s, r.Root)
	if err != nil || got != r {
		t.Fatalf("readback: %v %v", got, err)
	}
	r.TxID = strings.Repeat("c", 64)
	if err := Write(s, "writer", r); err == nil {
		t.Fatal("duplicate accepted")
	}
	got, err = Read(s, r.Root)
	if err != nil || got.TxID == r.TxID {
		t.Fatal("original record changed")
	}
	if err := Init(s, "attacker"); err == nil {
		t.Fatal("owner replaced")
	}
}
func TestInvalidAndStorageFailure(t *testing.T) {
	s := memory{}
	_ = Init(s, "writer")
	r := Record{Root: strings.Repeat("a", 64), PrevRoot: strings.Repeat("0", 64), BizDate: "20261301", TxID: strings.Repeat("b", 64)}
	if Write(s, "writer", r) == nil {
		t.Fatal("bad date accepted")
	}
	r.BizDate = "20261102"
	r.Root = "bad"
	if Write(s, "writer", r) == nil {
		t.Fatal("bad root accepted")
	}
	if _, err := Read(s, strings.Repeat("d", 64)); err == nil {
		t.Fatal("missing record accepted")
	}
	if Init(broken{}, "x") == nil {
		t.Fatal("store failure ignored")
	}
}
