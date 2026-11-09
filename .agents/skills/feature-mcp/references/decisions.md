# MCP decision provenance

Historical intent only; this record grants no login/config/token/credential operation authority.

Owner quote, 2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, preserved from the original feature-mcp entry:

> the MCP screens got pagination like this, but let it be infinite scroll; I think that gives a more compact design anyway, though this area may need rearranging. I think it is managed very badly (translated)

The retained interaction requirement is a continuous bounded list instead of numbered presentation paging. Discovery supplies a cached complete configured array; this decision does not require a backend cursor, repeat authentication/health checks, new provider scope or remote configuration authority.
