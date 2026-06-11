# ── Configurazione ────────────────────────────────────────────
CC       := gcc
CFLAGS   := -Wall -Wextra -std=c11 -pthread
CPPFLAGS := -Iinclude
TARGET   := backend
BUILD    := build

# ── Sorgenti e oggetti ────────────────────────────────────────
SRCS := $(wildcard src/*.c)
OBJS := $(patsubst src/%.c, $(BUILD)/%.o, $(SRCS))
DEPS := $(OBJS:.o=.d)

# ── Regole ────────────────────────────────────────────────────
.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $^ -o $@

$(BUILD)/%.o: src/%.c | $(BUILD)
	$(CC) $(CFLAGS) $(CPPFLAGS) -MMD -MP -c $< -o $@

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD) $(TARGET)

-include $(DEPS)

