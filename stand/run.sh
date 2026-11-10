#!/bin/sh
# Полный прогон стенда: сборка образов, запуск сервисов, e2e-тесты,
# обработка почты mail-sorter, проверка результата, остановка.
#   ./run.sh         — прогон и удаление стенда
#   ./run.sh --keep  — оставить стенд запущенным (UI: http://127.0.0.1:18100/)
set -e
cd "$(dirname "$0")"

compose () {
    docker compose "$@"
}

cleanup () {
    if [ "$KEEP" != 1 ]; then
        compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || :
    fi
}

KEEP=0
[ "$1" = "--keep" ] && KEEP=1
trap cleanup EXIT

compose --profile tools build
compose up -d --wait redis mail mail-server

# Пространства и ключи API. Ключи показываются один раз, поэтому конфигурация
# facade и переменные окружения для остальных контейнеров создаются здесь
cli () {
    script=$1
    shift
    compose exec -T mail-server node "server/dist/src/$script" "$@"
}
new_key () {
    cli apiKeysCli.js revoke "$1" >/dev/null 2>&1 || :
    cli apiKeysCli.js add "$@" | tr -d '\r\n'
}
for space in sales news; do
    cli spacesCli.js add "$space" --title "Stand $space" >/dev/null 2>&1 || :
done
mkdir -p .generated
STAND_SORTER_KEY=$(new_key stand-sorter --system)
STAND_FACADE_KEY=$(new_key stand-facade --system)
STAND_SALES_KEY=$(new_key stand-sales --space sales)
STAND_NEWS_KEY=$(new_key stand-news --space news)
printf '{\n  "apiKey": "%s",\n  "backend": "http://mail-server:8000",\n  "port": 8001\n}\n' \
    "$STAND_FACADE_KEY" >.generated/facade.json
printf 'export STAND_SORTER_KEY=%s\nexport STAND_SALES_KEY=%s\nexport STAND_NEWS_KEY=%s\n' \
    "$STAND_SORTER_KEY" "$STAND_SALES_KEY" "$STAND_NEWS_KEY" >.generated/keys.env
export STAND_SORTER_KEY STAND_SALES_KEY STAND_NEWS_KEY

compose up -d --wait facade client

echo "=== Stage 1: mailing, subscription, incoming mail"
compose run --rm e2e 1-mailing.test.js 1-spaces.test.js 1-attachments.test.js 1-images.test.js

echo "=== mail-sorter"
compose run --rm mail-sorter

echo "=== Stage 2: mail-sorter results"
compose run --rm e2e 2-after-sorter.test.js 2-spaces-after-sorter.test.js

echo "=== OK"
if [ "$KEEP" = 1 ]; then
    echo "Stand is running: UI http://127.0.0.1:${STAND_UI_PORT:-18100}/," \
         "facade http://127.0.0.1:${STAND_FACADE_PORT:-18101}/"
    echo "Stop: docker compose -f $(pwd)/compose.yml --profile tools down -v"
fi
