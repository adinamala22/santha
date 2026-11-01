# REST surface (/v1) — representative
Auth: POST /auth/otp/request · POST /auth/otp/verify · POST /auth/refresh · POST /auth/logout
Consumer: GET /serviceability?lat&lng · GET /feed?micro_market&tab · GET /search?q&micro_market&filters · GET /merchants/{id} · GET /merchants/{id}/items · PUT /cart · POST /cart/price · POST /cart/promo · POST /orders (Idempotency-Key) · GET /orders/{id} · POST /orders/{id}/cancel · POST /orders/{id}/issues · POST /orders/{id}/rating · GET /wallet · GET /me · PUT /me/addresses
Merchant: POST /merchants · GET /merchants/me · PUT /merchants/me/availability · POST /merchants/me/staff · POST /items · POST /items/scan · PUT /items/{id} · PUT /items/{id}/stock · POST /items/import · GET /merchants/me/orders · POST /orders/{id}/accept (body: fulfilment_mode, staff_id?) · POST /orders/{id}/reject · POST /orders/{id}/items/{iid}/unavailable · POST /orders/{id}/ready · GET /merchants/me/statements
Rider: PUT /riders/me/status · GET /offers · POST /offers/{id}/accept · POST /offers/{id}/decline · POST /jobs/{id}/picked-up · POST /jobs/{id}/delivered · POST /riders/me/location · GET /riders/me/earnings
Staff link (self-delivery): GET /staff-jobs/{token} · POST /staff-jobs/{token}/picked-up · POST /staff-jobs/{token}/delivered
Payments: POST /payments/intent · POST /webhooks/razorpay · POST /webhooks/kyc · POST /webhooks/whatsapp
Ops (/ops, RBAC: admin, ops, finance, support): merchants/queue · merchants/{id}/approve|pause|offboard · catalogue/qa · micro-markets · orders/live · orders/{id}/reassign · refunds · disputes · settlements/run · reconciliation · moderation · audit
WebSocket rooms: order:{id} · merchant:{id} · rider:{id}; events mirror domain events relevant to the room.
