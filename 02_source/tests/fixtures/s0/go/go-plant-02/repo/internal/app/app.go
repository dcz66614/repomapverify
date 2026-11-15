package app

import (
	"fmt"
	"example.com/demo/internal/store"
)

const Name = "app"

func Use() { fmt.Println(store.V) }
