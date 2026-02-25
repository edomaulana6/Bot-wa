#!/bin/bash
# Skrip Setup Otomatis Ubuntu
sudo apt update
sudo apt install -y python3 python3-pip ffmpeg
pip3 install -r requirements.txt
echo "Setup selesai. Jalankan bot dengan: python3 main.py"
