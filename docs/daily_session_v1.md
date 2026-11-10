# Sesión de hoy (`daily_session_v1`)

## Propósito
Que el tutor arme la mezcla del día: repasos, una práctica mixta, una de cálculo y el siguiente paso de la ruta. Solo cliente; no hay ruta nueva.

## Plan (`buildDailyPlan(goal, at, {lowQuota})`)
Función pura y determinista. Bloques en orden:
1. `review`: hasta 3 repasos vencidos, por fecha de vencimiento y después id.
2. `mixed`: uno, si está disponible. Con `d` = días desde epoch (fecha local): `d%3===0` → `error_hunt` si `errorHuntAvailable`; si no, `composition` si `compositionAvailable`; si no, `discrimination` si `mixedAvailable`.
3. `produce`: uno, si `productionAvailable` (práctica de cálculo, T7), sobre el primer tema candidato.
4. `learn`: siempre, el siguiente paso de `chooseNext`.

Un tema sin enseñanza no es candidato, por lo que nunca entra en `mixed` ni `produce`.
Con una reparación abierta (`goal.contextStack.length`) el plan es solo `[{kind:'resume_repair'}]`.
Con poca cuota (`calls_today >= daily_limit-4` en `/api/health`; si la consulta falla se asume que no) se omiten `mixed` y `produce` y se muestra «Hoy queda poca cuota: solo repasos guardados y lectura».

## Estado
`goal.daily = {version, date:'AAAA-MM-DD', plan:[{kind, node_id?, variant?, status:'pending'|'done'|'skipped', started_at?}], index, low_quota, started_at}`.
Si la fecha cambió, se reconstruye. Evento `{type:'SESSION_PLAN', date, plan:[kinds], at}` al crearlo: el plan anterior queda en el historial.

## Avance
- `review` y `learn` se marcan hechos por derivación (`dailySync`): el repaso ya no está vencido; hay evidencia de aprendizaje posterior al inicio del bloque.
- `mixed` y `produce` se marcan hechos en `endMixed` / `endProduction` solo si la práctica terminó (`status:'done'`); salir sin terminar no cuenta.
- «Saltar bloque» marca `skipped`. Al completar el plan se muestra un resumen: repasos hechos, aciertos, próxima fecha de repaso.

## Interfaz
Botón principal «Sesión de hoy» / «Continuar sesión de hoy» en el inicio de la meta; panel «Sesión de hoy» con los bloques. «Seguir aprendiendo» se conserva junto a él y el resto de botones pasan al grupo «Más práctica» (no se eliminó ninguno).

## Evidencia
Ninguna nueva. Construir, saltar o leer el plan no cambia cobertura, `verified()`, calendario de repasos ni eventos de evidencia. Cada actividad conserva su contrato.

## Reversión
El código anterior ignora `goal.daily` y los eventos `SESSION_PLAN`.

## Pruebas
`tests/daily_session.test.js`.
