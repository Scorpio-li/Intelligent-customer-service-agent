<script setup lang="ts">
import { useCounterStore } from '@/stores/counter'

const counter = useCounterStore()
</script>

<template>
  <section class="page-home">
    <h1>Home</h1>
    <p>Welcome to your Vue + Vite + TypeScript scaffold.</p>

    <div class="counter">
      <button @click="counter.decrement">-</button>
      <span>{{ counter.count }}</span>
      <button @click="counter.increment">+</button>
    </div>

    <p>
      Try the
      <router-link to="/about">About</router-link>
      page.
    </p>
  </section>
</template>

<style scoped>
.page-home {
  padding: 2rem;
}
.counter {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1rem 0;
}
.counter button {
  width: 2rem;
  height: 2rem;
}
</style>
