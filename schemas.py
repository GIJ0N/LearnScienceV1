import json
def compact(value,n=500): return str(value or "").strip()[:n]
def obj_schema(properties,required=None): return {"type":"OBJECT","properties":properties,"required":required or list(properties)}
T={"type":"STRING"}
Q=obj_schema({"prompt":T,"reference":T,"kind":T})
NODE=obj_schema({"id":T,"name":T,"outcome":T,"level":{"type":"INTEGER"},"prerequisites":{"type":"ARRAY","items":T},"kind":T,"probe":Q})
DIM=obj_schema({"id":T,"name":T,"required":{"type":"BOOLEAN"}})
COVER=obj_schema({"id":T,"name":T,"kind":T,"priority":T,"prerequisites":{"type":"ARRAY","items":T},"contexts":{"type":"ARRAY","items":T},"dimensions":{"type":"ARRAY","items":DIM}})
MAP_SCHEMA=obj_schema({"nodes":{"type":"ARRAY","items":NODE},"coverage":{"type":"ARRAY","items":COVER}})
STAGE_SCHEMA=obj_schema({"explanation":T,"example":T,"common_error":T,"check":Q,"guided":Q,"independent":Q,"integration":Q})
EVAL_SCHEMA=obj_schema({"status":T,"feedback":T,"error_type":T,"hint":T})
REVIEW_SCHEMA=obj_schema({"question":Q})
