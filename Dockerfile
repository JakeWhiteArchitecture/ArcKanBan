FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ARCKANBAN_HOST=0.0.0.0
ENV ARCKANBAN_PORT=5000
ENV ARCKANBAN_SERVER=waitress

EXPOSE 5000

CMD ["python", "app.py"]
