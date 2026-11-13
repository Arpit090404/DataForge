import sys
import duckdb
con = duckdb.connect(sys.argv[1] + '/analytics.duckdb')
print(con.execute('SELECT count(*) FROM ticks').fetchone()[0])
con.close()
