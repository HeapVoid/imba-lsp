# Parser smoke sample

import { db } from './db.imba'

export tag app-root
	title = "Imba in Zed"

	css self
		d:flex
		g:12px
		.title
			c:blue6

	def bad
		return if

	def save
		console.log("save")

	<self>
		<div.card @click=save [d:flex g:8px]>
			<span.title> title
				<span> 'Hello world'
