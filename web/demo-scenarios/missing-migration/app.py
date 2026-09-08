import sqlite3

connection = sqlite3.connect("demo.db")
connection.execute("create table if not exists users (id integer primary key, name text not null)")
connection.execute("insert or ignore into users values (1, 'Mina')")

for row in connection.execute("select id, name, avatar_url from users"):
    print(row)
