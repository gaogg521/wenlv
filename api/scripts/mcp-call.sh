#!/bin/bash
# usage: mcp-call.sh <method> [params-json]
TOK="ekuE8ra457fLz__xbHJdi0YBYVrCJn2d"
SID=$(curl -s -m 5 -D - -o /dev/null -X POST http://127.0.0.1:59470/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer $TOK" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"zc","version":"1"}}}' | grep -i "^mcp-session-id" | awk '{print $2}' | tr -d '\r')
BODY=$(python -c "import json,sys; print(json.dumps({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':sys.argv[1],'arguments':json.loads(sys.argv[2]) if len(sys.argv)>2 else {}}}))" "$1" "${2:-}")
curl -s -m 60 -X POST http://127.0.0.1:59470/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "Authorization: Bearer $TOK" -H "Mcp-Session-Id: $SID" -d "$BODY" | grep "^data:" | sed 's/^data: //' | python -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('result', d), ensure_ascii=False)[:3000])"
