# MCP decision provenance

Historical intent only; this record grants no login/config/token/credential operation authority.

Owner quote, 2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, preserved from the original feature-mcp entry:

> mcp ekranları bu şekilde pagination eklanmış ama infinite scroll olsun daha compact bir tasarım anlayışı zaten olur diye düşünüyorum ama buranında yeninden düzenlenmesi gerekebilir. Çok kötü yönetiliyor bence

The retained interaction requirement is a continuous bounded list instead of numbered presentation paging. Discovery supplies a cached complete configured array; this decision does not require a backend cursor, repeat authentication/health checks, new provider scope or remote configuration authority.
