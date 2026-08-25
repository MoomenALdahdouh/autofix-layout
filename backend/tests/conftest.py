import os
import sys
from pathlib import Path

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("DEV_SKIP_LICENSE", "true")
os.environ.setdefault("GROQ_API_KEY", "test-ci-placeholder")
os.environ.setdefault("CORS_ORIGINS", "")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
