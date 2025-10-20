#!/bin/sh
set -eu

git clone https://github.com/OpenDSU/Persisto.git && cd Persisto && npm install
echo "Persisto server installed"
