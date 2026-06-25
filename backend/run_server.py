"""Start KurdBox Backend v2.0"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

import uvicorn
uvicorn.run("app.main:app", host="0.0.0.0", port=5001, reload=False)
