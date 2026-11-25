import sqlite3,pathlib,json,sys,datetime
c=sqlite3.connect(pathlib.Path(r'C:\Users\kraba\.bycoda-host\host.db').as_uri()+'?mode=ro',uri=True)
def t(ms): return (datetime.datetime.utcfromtimestamp(ms/1000)+datetime.timedelta(hours=3)).strftime('%m-%d %H:%M:%S')
