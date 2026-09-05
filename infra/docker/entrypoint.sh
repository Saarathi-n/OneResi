#!/bin/sh
# Assembles DATABASE_URL inside the container, then hands over to the command.
#
# This exists because of D-10. RDS generates and rotates the master password into Secrets Manager, so
# Terraform never holds it and cannot compose a connection string without pulling the password into
# state. What the task definition does instead is put the password in `secrets`, which the ECS agent
# resolves at start-up — never in `environment`, where the previous build put a whole plaintext
# connection string with a committed password in it, readable in the console and in every retained task
# revision.
#
# So the container receives the four harmless parts as environment values and the one credential as a
# secret, and the string is built here, once, in memory.
set -eu

if [ "${DB_TARGET:-local}" = "cloud" ] && [ -z "${DATABASE_URL:-}" ]; then
  : "${DB_HOST:?DB_TARGET=cloud needs DB_HOST}"
  : "${DB_NAME:?DB_TARGET=cloud needs DB_NAME}"
  : "${DB_USER:?DB_TARGET=cloud needs DB_USER}"
  : "${DB_PASSWORD:?DB_TARGET=cloud needs DB_PASSWORD, which arrives through the task definition's secrets block}"

  # Percent-encoded, because a generated password may legitimately contain characters that would
  # otherwise terminate the userinfo section of the URL. Read from the environment rather than passed as
  # an argument, so the value never appears in a process listing.
  encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.env.DB_USER))')
  encoded_password=$(node -e 'process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))')

  DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}?sslmode=${DB_SSLMODE:-require}"
  export DATABASE_URL

  # Nothing downstream reads it again, and the parameter group refuses a connection that is not TLS
  # anyway.
  unset DB_PASSWORD encoded_password
fi

exec "$@"
