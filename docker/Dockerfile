FROM php:8.0-apache

RUN apt-get update && apt-get install -y libzip-dev zlib1g-dev libpng-dev libjpeg-dev libwebp-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install mysqli gd zip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
